import { TranslatorTextClient } from '@azure/cognitiveservices-translatortext';
import { CognitiveServicesCredentials } from '@azure/ms-rest-azure-js';
import { fail, strict } from 'assert';
import * as chalk from 'chalk';
import { stat } from 'fs/promises';
import { basename, join, normalize } from 'path';
import { argv } from 'process';
import { ForEachDescendantTraversalControl, Node, Project, PropertyAssignment, PropertyAssignmentStructure, StructureKind } from 'ts-morph';
import { parseArgs } from './lib/command-line';

/** ensures a string is string encoded and quoted correctly  */
function singleQuote(text: string) {
  return JSON.stringify(text).replace(/'/g, '\\\'').replace(/^"(.*)"$/, '\'$1\'');
}

/** removes backtick quotes from a string */
function unquote(text: string) {
  return (text.startsWith('`') && text.endsWith('`')) ? text = text.substr(1, text.length - 2) : text;
}

interface Dictionary<T> {
  [key: string]: T;
}

type templateStringParameter = { name: string, type: string };
type templateStringInfo = { literal: string; params: Array<templateStringParameter> };

const args = argv.slice(2);

function version() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(`${__dirname}/../package.json`).version;
}

function header() {
  console.log('');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  console.log(`${chalk.greenBright('Quick And Dirty Translation utility')} [version: ${chalk.white.bold(version())}; node: ${chalk.white.bold(process.version)}; max-memory: ${chalk.white.bold(Math.round((require('v8').getHeapStatistics().heap_size_limit) / (1024 * 1024)) & 0xffffffff00)} gb]`);
  console.log(chalk.white.bold('(C) 2021 Microsoft Corporation.'));
  console.log('https://github.com/azure/adl');
  console.log('');
}

async function isDirectory(target: string) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    //
  }

  return false;
}

async function main() {
  try {
    const commandline = parseArgs(args);
    const root = commandline.folder;
    strict.ok(isDirectory(root), `${root} should be a project folder`);
    let updatedFiles = 0;
    const key = commandline.switch('key', '--key specified more than once') || process.env['translator_key'] || fail('Missing translator key (--key or environment variable \'translator_key\') ');

    header();

    const azure = new TranslatorTextClient(new CognitiveServicesCredentials(key), 'https://api.cognitive.microsofttranslator.com/');
    const translationFilesFolder = commandline.output || join(root, 'i18n');

    const project = new Project({ tsConfigFilePath: join(root, 'tsconfig.json') });
    const translationFiles = project.getSourceFiles().filter(each => normalize(each.getFilePath()).startsWith(translationFilesFolder));
    const sourceFiles = project.getSourceFiles().filter(each => !normalize(each.getFilePath()).startsWith(translationFilesFolder));

    // right now it assumes the i18n function is in ${project}/lib/i18n.ts
    const i18nSourceFile = project.getSourceFiles().find(each => normalize(each.getFilePath()).startsWith(join(root, 'lib', 'i18n.ts')));

    const strings: Dictionary<templateStringInfo> = {};

    console.log(`${chalk.cyan('Project: ')}${root}\n${chalk.cyan('Source files to scan: ')}${sourceFiles.length}`);

    // track the i`` strings
    // eslint-disable-next-line no-inner-declarations
    function track(key: string, literal: string, params: Array<templateStringParameter> = []) {
      strings[unquote(key)] = { literal, params };
    }

    for (const sourceFile of sourceFiles) {
      // find all the template literals in the file
      sourceFile.forEachDescendant((node: Node, traversal: ForEachDescendantTraversalControl) => {
        try {
          if (Node.isTaggedTemplateExpression(node)) {
            const template = node.getTemplate();
            const tag = node.getTag();
            const tagType = tag.getType();
            const tagSymbol = tagType.getSymbol();

            // having found our tagged template literal, let's make sure that the declaration matches
            // the i`` one from our source file.
            const decl = tagSymbol?.getDeclarations()[0];
            if (Node.isFunctionDeclaration(decl)) {
              const sourceFile = decl?.getSourceFile();
              if (decl.getName() === 'i' && sourceFile === i18nSourceFile) {

                // we have found a tagged template literal, and it's one of ours.
                // let's start gathering the data for it.
                if (Node.isNoSubstitutionTemplateLiteral(template)) {
                  // simple, no params
                  track(template.getText(), template.getText());

                } else if (Node.isTemplateExpression(template)) {
                  // get the preamble
                  const templateHead = template.getHead();
                  let key = templateHead.getText();
                  let literal = templateHead.getText();

                  // get the parameterized sections that follow
                  const parameters = new Array<templateStringParameter>();
                  let parameterNumber = 0;
                  for (const span of template.getTemplateSpans()) {
                    const content = span.getChildAtIndex(0);
                    const text = span.getChildAtIndex(1);
                    // the key has to have ${number} instead of the template expression in it.
                    key = `${key}${parameterNumber}${text.getText()}`;

                    if (Node.isIdentifier(content)) {
                      // it's a simple identifier,
                      // that'll be the parameter name
                      const symbol = content.getSymbol();
                      const declaration = symbol?.getDeclarations();

                      const name = content.getText();
                      const type = declaration?.[0].getType().getText() || 'any'; //fallback to any

                      parameters.push({ name, type });
                      literal = literal + name + text.getText();
                    } else if (Node.isExpression(content)) {
                      // it's some kind of expression, we can get the type,
                      // but the name will have to be generated ('p<number>')
                      // just use a placeholder number for now.
                      const type = node.getType().getText();
                      const name = `p${parameterNumber}`;

                      parameters.push({ name, type });
                      literal = literal + name + text.getText();
                    }
                    parameterNumber++;
                  }
                  // now that we have all the parameters, lets track this one
                  track(key, literal, parameters);
                }
              }
            }
          }
        } catch {
          //
        }
      });
    }

    // let's make sure there are entries in all of the language translations
    for (const lang of translationFiles) {
      // get the language name from the source file name
      const language = basename(lang.getFilePath()).replace(/\.ts$/, '');

      let isModified = false;

      // find the declaration of 'map'
      const map = lang.getVariableDeclarations().find(variable => variable.getSymbol()?.getEscapedName() === 'map');
      if (Node.isVariableDeclaration(map)) {
        const initializer = map.getInitializer();
        const props: Dictionary<PropertyAssignment | null> = {};

        if (Node.isObjectLiteralExpression(initializer)) {

          // record all the properties we have already.
          for (const prop of initializer.getProperties()) {
            if (Node.isPropertyAssignment(prop)) {
              const name = prop.getName();
              const pa = prop.getInitializer();
              props[name] = Node.isPropertyAssignment(pa) ? pa : null;
            }
          }

          // let's see if all of our strings are in there.
          for (const key in strings) {
            const fn = strings[key];
            const name = singleQuote(key);

            if (props[name] === undefined) {
              // missing a string! let's add it.

              const pp = fn.params.map(each => `${each.name}: ${each.type}`);
              const text = pp.length === 0 ? name : fn.literal;
              let translation = '';
              try {
                const placeholders = new Array<string>();
                let i = 0;

                // whackety-whack, this is a hack.
                // numbers seem to make it thru translation without
                // too much trouble, so let's stick in a weird number
                // for each parameter so we can put the parameter name
                // back at the end.
                const t = text.replace(/(\$\{.*?\})/g, (item) => {
                  placeholders[i] = item;
                  // insert a number that's not likely to be there
                  return `77${i++}77`;
                });

                // Azure, please translate this for me
                const result = await azure.translator.translate([language], [{ text: t }]);
                translation = result[0]?.translations?.[0].text || text;

                // if we had whackety-whack parameters, let's fix them back up
                if (i > 0) {
                  translation = translation.replace(/77(.*?)77/g, (item, value, pos, string) => {
                    // return the original template to the string
                    return placeholders[Number.parseInt(value)];
                  });
                  // backtick quote it (parameterized strings are templates in the translation.)
                  translation = '`' + translation.substr(1, translation.length - 2) + '`';
                } else {
                  // single quote it (non-parameterized strings are just single quoted strings)
                  translation = '\'' + translation.substr(1, translation.length - 2) + '\'';
                }
              } catch (e) {
                //
                // console.log(e);
              }
              if (!translation) {
                translation = text;
              }
              // Now we can create the property assignment for that string
              initializer.addProperty(<PropertyAssignmentStructure>{
                name,
                kind: StructureKind.PropertyAssignment,
                initializer: `(${pp.join(',')}) => {
              // autotranslated using Azure Translator (${text})
              return ${translation};
            }`
              });
              // keep track that we're modifying this file.
              isModified = true;
            }
          }
        }

        // only save files that we actually touch.
        if (isModified) {
          // clean up formatting
          lang.formatText({
            indentSize: 2,
          });
          lang.saveSync();
          updatedFiles++;
          console.log(`${chalk.yellowBright('Updated i18n lang file')}: ${chalk.greenBright(lang.getFilePath())}`);
        }
      }
    }

    console.log(`\n${chalk.greenBright('Summary: ')}files updated: ${updatedFiles}`);
  } catch (e) {
    console.error(`${chalk.redBright('Error')}: ${e.message}`);
  }
}

void main();

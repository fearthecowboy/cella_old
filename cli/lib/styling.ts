/*---------------------------------------------------------------------------------------------
 *  Copyright 2021 (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Session } from '@microsoft/cella.core';
import { blue, cyan, gray, green, red, white, yellow } from 'chalk';
import * as md from 'marked';
import * as renderer from 'marked-terminal';
import { CommandLine } from './command-line';

function formatTime(t: number) {
  return (
    t < 3600000 ? [Math.floor(t / 60000) % 60, Math.floor(t / 1000) % 60, t % 1000] :
      t < 86400000 ? [Math.floor(t / 3600000) % 24, Math.floor(t / 60000) % 60, Math.floor(t / 1000) % 60, t % 1000] :
        [Math.floor(t / 86400000), Math.floor(t / 3600000) % 24, Math.floor(t / 60000) % 60, Math.floor(t / 1000) % 60, t % 1000]).map(each => each.toString().padStart(2, '0')).join(':').replace(/(.*):(\d)/, '$1.$2');
}

// setup markdown renderer
md.setOptions({
  renderer: new renderer({
    tab: 2,
    emoji: true,
    showSectionPrefix: false,
    firstHeading: green.underline.bold,
    heading: green.underline,
    codespan: white,
    link: blue.bold,
    href: blue.bold.underline,
    code: gray
  }),
  gfm: true,
});

export let log: (message?: any, ...optionalParams: Array<any>) => void = console.log;
export let error: (message?: any, ...optionalParams: Array<any>) => void = console.error;
export let warning: (message?: any, ...optionalParams: Array<any>) => void = console.error;
export let debug: (message?: any, ...optionalParams: Array<any>) => void = (text) => { console.log(`${cyan.bold('debug: ')}${text}`); };

export function initStyling(commandline: CommandLine, session: Session) {
  log = (text) => console.log((md(text).trim()));
  error = (text) => console.log(`${red.bold('ERROR:')}${md(text).trim()}`);
  warning = (text) => console.log(`${yellow.bold('WARNING:')}${md(text).trim()}`);
  debug = (text) => { if (commandline.debug) { console.log(`${cyan.bold('DEBUG:')}${md(text).trim()}`); } };

  session.channels.on('message', (text: string, context: any, msec: number) => {
    log(text);
  });

  session.channels.on('error', (text: string, context: any, msec: number) => {
    error(text);
  });

  session.channels.on('debug', (text: string, context: any, msec: number) => {
    debug(`${cyan.bold(`[${formatTime(msec)}]`)} ${md(text)}`);
  });

  session.channels.on('warning', (text: string, context: any, msec: number) => {
    warning(text);
  });

}
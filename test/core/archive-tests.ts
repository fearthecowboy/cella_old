/*---------------------------------------------------------------------------------------------
 *  Copyright 2021 (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LocalFileSystem, ZipUnpacker } from '@microsoft/cella.core';
import { strict } from 'assert';
import { join } from 'path';
import { rootFolder, SuiteLocal } from './SuiteLocal';

describe('ZipUnpacking', () => {
  const local = new SuiteLocal();
  const fs = new LocalFileSystem(local.session);
  const unpacker = new ZipUnpacker(local.session);
  it('UnpacksLegitimateSmallZips', async () => {
    const zipPath = join(rootFolder(), 'resources', 'example-zip.zip');
    const targetPath = join(local.tempFolder, 'example');
    const targetUri = fs.parse(targetPath);
    await unpacker.unpack(fs.parse(zipPath), targetUri, {});
    strict.equal((await targetUri.readFile('a.txt')).toString(), 'The contents of a.txt.\n');
    strict.equal((await targetUri.readFile('b.txt')).toString(), 'The contents of b.txt.\n');
    strict.equal((await targetUri.readFile('c.txt')).toString(), 'The contents of c.txt.\n');
    strict.equal((await targetUri.readFile('a-directory/a.txt')).toString(), 'The contents of a.txt.\n');
    strict.equal((await targetUri.readFile('a-directory/b.txt')).toString(), 'The contents of b.txt.\n');
    strict.equal((await targetUri.readFile('a-directory/c.txt')).toString(), 'The contents of c.txt.\n');
  });

  it('UnpacksZipsWithCompression', async () => {
    // big-compression.zip is an example input from yauzl:
    // https://github.com/thejoshwolfe/yauzl/blob/96f0eb552c560632a754ae0e1701a7edacbda389/test/big-compression.zip
    const zipPath = join(rootFolder(), 'resources', 'big-compression.zip');
    const targetPath = join(local.tempFolder, 'big-compression');
    const targetUri = fs.parse(targetPath);
    await unpacker.unpack(fs.parse(zipPath), targetUri, {});
    const contents = await targetUri.readFile('0x100000');
    strict.equal(contents.length, 0x100000);
    strict.ok(contents.every((value: number) => value === 0x0));
  });

  it('FailsToUnpackMalformed', async () => {
    // wrong-entry-sizes.zip is an example input from yauzl:
    // https://github.com/thejoshwolfe/yauzl/blob/96f0eb552c560632a754ae0e1701a7edacbda389/test/wrong-entry-sizes/wrong-entry-sizes.zip
    const zipPath = join(rootFolder(), 'resources', 'wrong-entry-sizes.zip');
    const targetPath = join(local.tempFolder, 'wrong-entry-sizes');
    const targetUri = fs.parse(targetPath);
    let pass = true;
    try {
      // can't use strict.throws due to the next await:
      await unpacker.unpack(fs.parse(zipPath), targetUri, {});
      pass = false;
    } catch (error)
    // eslint-disable-next-line no-empty
    { }
    strict.ok(pass);
  });
});

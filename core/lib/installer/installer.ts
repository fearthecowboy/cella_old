import { Installer } from '../metadata-format';
import { Session } from '../session';

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export abstract class InstallerImpl {
  constructor(protected session: Session) {

  }

  abstract install(id: string, version: string, install: Installer): Promise<void>;


}
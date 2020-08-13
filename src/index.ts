import { API } from 'homebridge';

import { PLATFORM } from './settings';
import { KonnectedHomebridgePlatform } from './platform';

export = (api: API) => {
  api.registerPlatform(PLATFORM, KonnectedHomebridgePlatform);
}
[![konnected.io](https://raw.githubusercontent.com/konnected-io/docs/master/assets/images/logo-black-small.png)](https://konnected.io)
# Konnected Alarm Panel plugin for Homebridge
[![NPM](https://nodei.co/npm/homebridge-konnected.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/homebridge-konnected/)

[![GitHub release](https://img.shields.io/github/release/konnected-io/homebridge-konnected.svg?style=flat-square)](https://github.com/konnected-io/homebridge-konnected/releases)
[![npm](https://img.shields.io/npm/dm/homebridge-konnected.svg)](https://www.npmjs.com/package/homebridge-konnected)
[![npm](https://img.shields.io/npm/v/homebridge-konnected.svg)](https://www.npmjs.com/package/homebridge-konnected)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![Lint & Build](https://github.com/konnected-io/homebridge-konnected/workflows/Lint%20&%20Build/badge.svg)](https://github.com/konnected-io/homebridge-konnected/actions)

# ⚠️ WARNING ⚠️
*This repository is in development is not ready for public use.*

The first stable version will be made public as an official github release (this is not a release, please read about [github releases](https://docs.github.com/en/enterprise/2.16/user/github/administering-a-repository/about-releases) for more information). As of yet, we do not have a release date planned, but progress on this project is actively being made. Thank you for your patience.

# Supported Features

 * Querying panels
   * Arming
   * Disarming
 * Sensors
   * Door sensor states
   * Window sensor states
   * Motion sensor states
   * Glass-break sensor states
   * Smoke/CO2 detector states
 * Professional 24/7 Smart Home Monitoring (powered by [Noonlight](https://noonlight.com/))

# Installation

1. Install homebridge: `npm install -g homebridge`
2. Install this plugin: `npm install -g homebridge-konnected`
3. Update your configuration file (see below).

# Configuration

### Sample config.json:


```json
{
    "platform": "konnected",
    "name": "Alarm Panel",
    "ip": "###.###.###.###",
    "id": "##########",
    "zones": [
      {
        "id": "##########",
        "name": "Front Door",
        "type": "contact",
        "ignore": false
      },
      {
        "id": "##########",
        "name": "Living Room",
        "type": "motion",
        "ignored": true
      },
      {
        "id": "##########",
        "name": "Kitchen",
        "type": "air",
        "ignored": false
      }
    ],
    "noonlight": [
      {
        "username": "<YOUR USERNAME>",
        "password": "<YOUR PASSWORD>",
        "geolocation": "-34.397,150.644",
        "primaryphone": "555-555-5555",
        "secondaryphone": "555-555-5555"
      }
    ],
    "logLevel": 1
}
```
### Fields:

* "platform": Must always be "konnected" (required)
* "name": Can be anything (required)
* "ip": This should be auto-detected, but you can manually point homebridge to another address (required)
* "id": This should be auto-detected, but you can manually point homebridge to another id (required)
* "zones": TBD
* "noonlight": TBD
* <details><summary>"logLevel": Adjust what gets reported in the logs <strong>(click to expand)</strong></summary><ul><li>0 = NO LOG ENTRIES</li><li>1 = ONLY ERRORS</li><li>2 = ONLY WARNINGS and ERRORS</li><li><strong>3 = GENERAL NOTICES, ERRORS and WARNINGS (default)</strong></li><li>4 = VERBOSE (everything including development output, this also generates a file `konnected-payload.json` with the payload details from the Konnected Alarm Panel in the same folder as the Homebridge config.json file)</li></ul></details>

# Troubleshooting

Before assuming that something is wrong with the plugin, please review the [issues on this project's github repository](https://github.com/konnected-io/homebridge-konnected/issues?utf8=%E2%9C%93&q=sort%3Aupdated-desc+) to see if there's already a similar issue reported where a solution has been proposed.

If you are updating from a Konnected Alarm Panel version or from non-Pro to Pro, you may be required to delete the `~/.homebridge/accessories/cachedAccessories` file for the new platform to show up with the new panel, accessories and devices.

**WARNING:** If you delete the contents of the `~/.homebridge/persist` folder, your Homebridge and devices will become unresponsive and you will have to entirely re-pair the Homebridge bridge (remove and re-scan the QR-code for Homebridge and set up all of your accessories/devices again).

### Logging

The default setting for log entries is set to report critical errors, warnings about devices and notices about connecting to the Konnected Alarm Panel. Once you feel that your security system zones are being represented in HomeKit correctly you can choose to reduce the amount of information being output to the logs to save space or remove cruft while troubleshooting other Homebridge plugins.

Log behaviour can be changed by adding or modifying the "logLevel" field to the Konnected platform block in the Homebridge configuration file.

### Ignoring Zones

To ignore zones that you wish to hide in Homekit (e.g., a specific sensor), simply add ```"ignore": true``` to each zone's section in the config. If the hidden zone(s) still exist in Homekit (or vice-versa they still don't show up after un-ignoring them), then you may be required to delete the `~/.homebridge/accessories/cachedAccessories` file as they may still be stored in the cache within Homebridge.


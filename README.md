[![konnected.io](https://raw.githubusercontent.com/konnected-io/docs/master/assets/images/logo-black-small.png)](https://konnected.io)
# Konnected Alarm Panel plugin for Homebridge
[![NPM](https://nodei.co/npm/homebridge-konnected.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/homebridge-konnected/)

[![GitHub release](https://img.shields.io/github/release/konnected-io/homebridge-konnected.svg?style=flat-square)](https://github.com/konnected-io/homebridge-konnected/releases)
[![npm](https://img.shields.io/npm/dm/homebridge-konnected.svg)](https://www.npmjs.com/package/homebridge-konnected)
[![npm](https://img.shields.io/npm/v/homebridge-konnected.svg)](https://www.npmjs.com/package/homebridge-konnected)
[![Lint & Build](https://github.com/konnected-io/homebridge-konnected/workflows/Lint%20&%20Build/badge.svg)](https://github.com/konnected-io/homebridge-konnected/actions)

# ⚠️ WARNING ⚠️
*This repository is in development is not ready for public use.*

The first stable version will be made public as an official github release (this is not a release, please read about [github releases](https://docs.github.com/en/enterprise/2.16/user/github/administering-a-repository/about-releases) for more information). As of yet, we do not have a release date planned, but progress on this project is actively being made. Thank you for your patience.

# Supported Features

 * Alarm System
   * Arming
   * Disarming
 * Sensors
   * Contact Sensor States
   * Motion Sensor States
   * Glass Break Sensor States
   * Temperature Sensor States
   * Temperature/Humidity Sensor States
   * Water Sensor States
   * Smoke Sensor States
 * Actuators
   * Alarm Siren Switch
   * Alarm Strobe Light Switch
   * Basic Binary Switch
 * Professional 24/7 Smart Home Monitoring (powered by [Noonlight](https://noonlight.com/))

# Installation

1. Install homebridge: `npm install -g homebridge`
2. Install this plugin: `npm install -g homebridge-konnected`
3. Update your configuration file (see below).

# Configuration

### Starter Settings for config.json:
The following two fields are required for the Konnected plugin to start.
```json
{
  "name": "Konnected",
  "platform": "konnected"
}
```

After loading this plugin for the first time, it will attempt to discover the Konnected panel(s) on the same LAN network as Homebridge. Once discovered, the plugin will attempt to:
1. adjust the config.json file with the details of the discovered panel(s), assigning a name and a unique identifier for each;
2. to provision each panel, the result of which is either a fresh panel without zones, or resetting/removing all zones on the panel(s).


### Zone Settings Example for config.json:
The following example is not exhaustive, however the best way to generate the rest of the values below in your config is by installing and using the [Config UI X plugin](https://github.com/oznu/homebridge-config-ui-x#readme) for Homebridge as all of the settings are easily configurable in a convenient GUI interface.
```json
{
  "name": "Konnected",
  "advanced": {
      "listenerPort": 5000,
      "listenerIP": "192.168.2.213",
      "discoveryTimeout": 10
  },
  "panels": [{
          "name": "Konnected V1/V2",
          "uuid": "8f655392-a778-4fee-97b9-123456789abc",
          "zones": [{
                  "zoneNumber": 1,
                  "zoneType": "contact",
                  "zoneLocation": "Front Entrance"
              },
              {
                  "zoneNumber": 2,
                  "zoneType": "motion",
                  "zoneLocation": "Living Room"
              }
          ]
      },
      {
          "name": "Konnected Pro",
          "uuid": "8f655392-a778-4fee-97b9-123456789abd",
          "zones": [{
                  "zoneNumber": 8,
                  "zoneType": "motion",
                  "zoneLocation": "Master"
              },
              {
                  "zoneNumber": 9,
                  "zoneType": "motion",
                  "zoneLocation": "Kitchen"
              }
          ]
      }
  ],
  "platform": "konnected"
}
```


### Fields:

* **"platform"**: *(required)* Must always be "konnected" 
* **"name"**: *(required)* Can be anything, it is the name that will appear in your Homebridge log.
* **"advanced"**: an object of optional advanced plugin settings:
  * **"listenerIP"**: *(optional)* Force panels to send zone state changes to an IPV4 address that represents this system on the network. *In some cases, your system may have multiple network adapters registered (eg. wifi, ethernet, etc.).*
  * **"listenerPort"**: *(optional)* Force panels to send zone state changes to a specific listening port on this system (between 1000 and 65535). 
  * **"discoveryTimeout"**: *(optional)* A length of time in seconds (between 1 and 300) to allow this plugin to discover all of Konnected panels on the network.
* **"panels"**: An array of objects that represent the various panel details and features To associate different sensors and actuators a panel must eventually exist in this config section:
  * **"name"** *(required)* The name of the specific panel.
  * **"UUID"** *(required/auto-generated/readonly)* The unique identifier for the panel.
  * **"zones"**: *(optional)* An array of objects that represent assigned zones on the panel:
    * **"zoneNumber"**: Depending on the panel board, the following assignments are allowed:
      * *V1/V2 Panel: 1 through 7 (7 is out or alarm).*
      * *Pro Panel: 1 through 15 (13 is alarm1, 14 is out, and 15 is alarm2).*
    * **"zoneType"**: any one of the following:
      * "contact":
      * "motion":
      * "glass": 
      * "temperature"
      * "temphumid"
      * "water"
      * "smoke"
      * "siren" (actuator)
      * "strobe" (actuator)
      * "switch" (actuator)
    * **"zoneLocation"**: (optional) Custom name for the zone's location.

# Troubleshooting

Before assuming that something is wrong with the plugin, please review the [issues on this project's github repository](https://github.com/konnected-io/homebridge-konnected/issues?utf8=%E2%9C%93&q=sort%3Aupdated-desc+) to see if there's already a similar issue reported where a solution has been proposed.

If you are updating from a Konnected Alarm Panel version or from non-Pro to Pro, you may be required to delete the `~/.homebridge/accessories/cachedAccessories` file for the new platform to show up with the new panel, accessories and devices.

**WARNING:** If you delete the contents of the `~/.homebridge/persist` folder, your Homebridge and devices will become unresponsive and you will have to entirely re-pair the Homebridge bridge (remove and re-scan the QR-code for Homebridge and set up all of your accessories/devices again).


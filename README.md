<p align="center">
  <a href="https://github.com/homebridge/verified/blob/master/verified-plugins.json"><img alt="Homebridge Verified" src="https://raw.githubusercontent.com/konnected-io/homebridge-konnected/master/branding/Konnected_w_Homebridge.svg?sanitize=true" width="500px"></a>
</p>

# Konnected Homebridge Plugin
[![GitHub Release](https://flat.badgen.net/github/release/konnected-io/homebridge-konnected/master?icon=github)](https://github.com/konnected-io/homebridge-konnected/releases)
[![npm Release](https://flat.badgen.net/npm/v/homebridge-konnected?icon=npm)](https://www.npmjs.com/package/homebridge-konnected)

[![Lint & Build](https://flat.badgen.net/github/checks/konnected-io/homebridge-konnected?icon=github&label=lint%20%26%20build)](https://github.com/konnected-io/homebridge-konnected/actions)
[![npm Download Total](https://flat.badgen.net/npm/dt/homebridge-konnected?icon=npm)](https://www.npmjs.com/package/homebridge-konnected)

[![Homebridge Verified](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![HOOBS Certified](https://flat.badgen.net/badge/hoobs/unsupported/orange)](https://plugins.hoobs.org/plugin/homebridge-konnected)
[![Apple HomeKit](https://flat.badgen.net/badge/apple/homekit/f89f1a?icon=apple)](https://www.apple.com/ios/home/)
[![License: MIT](https://flat.badgen.net/badge/license/MIT/blue)](https://github.com/konnected-io/homebridge-konnected/blob/master/LICENSE)

# ⚠️ WARNING ⚠️
*This repository is now in beta for public testing.*

# Supported Features

  * Sensors
    * Contact Sensor States
    * Motion Sensor States
    * Glass Break Sensor States
    * Temperature Sensor States
    * Humidity Sensor States
    * Smoke Sensor States
    * Water Sensor States
  * Actuators
    * Alarm Arm/Disarm Switch (defaults to basic switch)
    * Alarm Siren Switch
    * Alarm Strobe Light Switch
    * Basic Binary Switch

# Upcoming Features

  * HomeKit native alarm system switch
  * Professional 24/7 smart home monitoring (powered by [Noonlight](https://noonlight.com/))
  * Adding option to set poll intervals for DHT/DS18B20 sensors
  * Add option to have a panic button tile to trigger the alarm system
  * Add option to have a switch tile that reports the state of a siren, allowing you to turn the siren off
  * HOOBS integration (this may happen automatically when HOOBS 4.x comes out and supports the configuration schema used in Homebridge)
  

# Installation

  1. Install homebridge: `npm install -g homebridge`
  2. Install this plugin: `npm install -g homebridge-konnected`
  3. Update your configuration file (see below)

# Configuration

### Starter Settings for config.json:
The following two fields are required for the Konnected plugin to start.
```json
{
  "name": "Konnected",
  "platform": "konnected"
}
```

After loading this plugin **for the first time**, it will attempt to discover the Konnected panel(s) on the same local network as Homebridge. Once discovered, the plugin will try to:
1. adjust the config.json file with the details of the discovered panel(s), assigning a name, a unique identifier, the IP address, and port for each panel;
2. provision each panel, the result is a fresh panel with unassigned zones.


### Zone Settings Example for config.json:
The best way to generate an error-free config.json is by installing and using the [Config UI X Plugin](https://github.com/oznu/homebridge-config-ui-x#readme) for Homebridge. The Konnected Homebridge plugin binds to the Config UI X configuration GUI which makes setting up the zones a trivial process.

For those without Config UI X, or are running this on HOOBS < 4.0.1 (not released yet), please see the following example configuration for this plugin:
```json
{
  "name": "Konnected",
  "advanced": {
    "listenerPort": 5000,
    "listenerIP": "192.168.2.213",
    "discoveryTimeout": 10
  },
  "panels": [
    {
      "name": "Konnected V1/V2",
      "uuid": "8f655392-a778-4fee-97b9-123456789abc",
      "ipAddress": "192.168.1.110",
      "port": 12345,
      "blink": true,
      "zones": [
        {
          "zoneNumber": 1,
          "zoneType": "switch",
          "zoneLocation": "Living Room",
          "invert": false,
          "switchSettings": {
            "trigger": 1,
            "pulseDuration": 1000,
            "pulsePause": 500,
            "pulseRepeat": 3
          }
        },
        {
          "zoneNumber": 2,
          "zoneType": "contact",
          "zoneLocation": "Front Entrance",
          "invert": false
        }
      ]
    },
    {
      "name": "Konnected Pro",
      "uuid": "8f655392-a778-4fee-97b9-123456789abd",
      "ipAddress": "192.168.1.120",
      "port": 54321,
      "blink": false,
      "zones": [
        {
          "zoneNumber": 1,
          "zoneType": "motion",
          "zoneLocation": "Master",
          "invert": true
        },
        {
          "zoneNumber": 9,
          "zoneType": "temphumid",
          "zoneLocation": "Kitchen",
          "invert": false
        }
      ]
    }
  ],
  "platform": "konnected"
}
```


### Configuration Field Explanations:

* **"platform"**: *(required)* Must always be "konnected" 
* **"name"**: *(required)* Can be anything, it is the name that will appear in your Homebridge log.
* **"advanced"**: an object of optional advanced plugin settings:
  * **"listenerIP"**: *(optional)* Force panels to send zone state changes to an IPV4 address that represents this system on the network. *In some cases, your system may have multiple network adapters registered (eg. wifi, ethernet, etc.).*
  * **"listenerPort"**: *(optional)* Force panels to send zone state changes to a specific listening port on this system (between 1000 and 65535). 
  * **"discoveryTimeout"**: *(optional)* A length of time in seconds (between 1 and 300) to allow this plugin to discover all of Konnected panels on the network.
* **"panels"**: An array of objects that represent the various panel details and features To associate different sensors and actuators a panel must eventually exist in this config section:
  * **"name"** *(required)* The name of the specific panel.
  * **"UUID"** *(required/auto-generated/readonly)* The unique identifier for the panel.
  * **"ipAddress"** *(optional/auto-generated)* The active IP address of the panel.
  * **"port"** *(optional/auto-generated)* The active network port of the panel.
  * **"blink"** *(optional)* Blink panel LED when zones change/report their state.
  * **"zones"**: *(optional)* An array of objects that represent assigned zones on the panel:
    * **"zoneNumber"**: Depending on the panel, the following assignments are allowed:
      * V1/V2 Panel: 1 through 6, 'out' or 'alarm').
      * Pro Panel: 1 through 12, 'alarm1', 'out', 'alarm2_out2').
    * **"zoneType"**: any one of the following:
      * "contact"
      * "motion"
      * "glass" 
      * "temperature"
      * "temphumid" or "temperature_humidity" (will expose two sensors in HomeKit)
      * "water"
      * "smoke"
      * "armingswitch" *(actuator switch)*
      * "siren" *(actuator switch)*
      * "strobe" *(actuator switch)*
      * "switch" *(actuator switch)*
    * **"zoneLocation"**: *(optional)* Custom name for the zone's location (Example: Kitchen).
    * **"invert"**: *(optional)* Flip the state of a zone sensor's input.
    * **"switchSettings"**: *(optional)* Switch-only object of settings when actuating the switch:
      * **"trigger"**: *(required, default: High)* Trigger state when switch is considered 'on'.
      * **"pulseDuration"**: *(optional)* How long the pulse is maintained in the on state for (in milliseconds).
      * **"pulsePause"**: *(conditional)* Pause between pulses (in milliseconds - required if pulseRepeat exists).
      * **"pulseRepeat"**: *(conditional)* Times to repeat pulse sequence (required if pulsePause exists - infinite set to a value of -1)

# Troubleshooting

Before anything, please review the [Konnected Homebridge Forum](https://help.konnected.io/support/discussions/forums/32000043024) to see if there's already a similar issue reported where a solution has been proposed.

If you cannot resolve the issue, please [Post a Forum Topic](https://help.konnected.io/support/discussions/topics/new?forum_id=32000043024) with the following details:

* Describe the Bug
* Steps to Reproduce
* Expected Behavior
* Attach Files to Support Your Experience:
  * Screenshots
  * Log Snapshot (txt file)
* Homebridge System:
  * Node.js Version
  * NPM Version
  * Homebridge/HOOBS Version
  * Operating System: *(Raspbian / Ubuntu / Debian / Windows / macOS / Docker)*
  * Process Supervisor: *(Docker / Systemd / init.d / pm2 / launchctl / hb-service / other / none)*
* Konnected Panel(s):
  * Panel Hardware Version
  * Firmware Version
  * Addon Panel(s)
  * Interface Panel(s)
* Any Additional Relevant Information

### "Did You Try Rebooting It?":

Sometimes fixing a problematic Homebridge/HOOBS/HomeKit accessory is as simple as deleting Homebridge's `cachedAccessories` file.

1. First stop Homebridge/HOOBS.
2. Delete the `cachedAccessories` file which is commonly located in its respective folder:

    * Homebridge:
      * Linux-based/MacOS: `~/.homebridge/accessories/cachedAccessories`
      * Windows: `$HOME\.homebridge\Accessories\cachedAccessories`
    * HOOBS:
      * HOOBSBox/Linux-based/MacOS:
      * v3.x: `~/.hoobs/etc/accessories/cachedAccessories`
      * v4.x: `/var/lib/hoobs/accessories/cachedAccessories`
      * <strike>Windows</strike> (HOOBS does not work on Windows)

3. Once the file is deleted, start up Homebridge/HOOBS and allow it to regenerate your accessories and the cache.

**WARNING:** Be careful to not delete the `persist` folder or its contents! Your Homebridge and devices will become unresponsive and you will have to entirely re-pair the Homebridge bridge (remove and re-scan the QR-code for Homebridge and set up all of your accessories/devices again).


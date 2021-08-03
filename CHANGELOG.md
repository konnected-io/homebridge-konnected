## [1.1.8](https://github.com/konnected-io/homebridge-konnected/compare/1.1.7...1.1.8) (2021-08-03)

## [1.1.7](https://github.com/konnected-io/homebridge-konnected/compare/1.1.6...1.1.7) (2021-08-03)

## [1.1.6](https://github.com/konnected-io/homebridge-konnected/compare/1.1.5...1.1.6) (2021-07-31)

### Changes:
* Turns off solid/momentary beeper if Security System is disarmed before the entry delay completes and the Security System is triggered. (bc5ce4a)

## [1.1.5](https://github.com/konnected-io/homebridge-konnected/compare/1.1.4...1.1.5) (2021-07-31)

### Changes:
* Fixes entry delay default of having a constantly 'on' state for beepers that don't have any custom momentary settings. (2949256)
* Fixes multiple sensor triggering, current Security System state assignments, and renames variable for semantics. (3c3d0d4)
* Resorts funding options. (c628419)
* Removes processing of temperature and humidity sensor actions. (f659a08)

## [1.1.4](https://github.com/konnected-io/homebridge-konnected/compare/1.1.3...1.1.4) (2021-07-21)

### Changes:
* Fixes location of call to process sensor accessory actions. (16b3317)
* Fixes invalid value for characteristic properties on the security system service. (008cd1a)
* Corrects typo and terminology. (b122a5c)

## [1.1.3](https://github.com/konnected-io/homebridge-konnected/compare/1.1.2...1.1.3) (2021-07-20)

### Changes:
* Adjusts instructions for Triggerable Modes for HOOBS configuration user interface. (b9ab752)

## [1.1.2](https://github.com/konnected-io/homebridge-konnected/compare/1.1.1...1.1.2) (2021-07-20)

### Changes:
* Fixes field and section titles for HOOBS configuration user interface. (d0a552f)

## [1.1.1](https://github.com/konnected-io/homebridge-konnected/compare/1.1.0...1.1.1) (2021-07-20)

### Changes:
* README formatting cleanup. (b9480f5)
* Clarifies instructions for required panel IP and Port fields in the plugin's configuration. (5f315b3)
* Refactors config.json update method, per @mkellsy's suggestions. (aa34f46)
* Code cleanup, removes empty line gaps. (abdf8d2)
* Updates README features and hero image alt text. (bc7334e)
* Adds funding options to the plugin. Please fund my work if you use this plugin! https://github.com/sponsors/mkormendy (6ac566e)
* Adds more keywords to the package for better search terms. (4378e30)
* Updates the author and contributor details. (77b80a3)
* Cleans up package name and description to be more consistent with all Homebridge plugins. (afc9fd2)
* Removes ending the NodeJS process prematurely. (968d6fc)

## [1.1.0](https://github.com/konnected-io/homebridge-konnected/compare/1.0.2...1.1.0) (2021-07-15)

### ⚠️ Breaking Changes:
Apologies again, but there were some issues with the way that actuator/switches had their states triggered on the boards and the code has been refactored to make this feature more succinct and also semantic to the user.  In particular, if you have a switch that needs to change its trigger state (not the same as triggerable mode - that's different) from "high" to "low" --- instead of using "1" or "0", you instead use "high" or "low" respectively. 

As usual, please refer to the [README documentation](https://github.com/konnected-io/homebridge-konnected/blob/master/README.md) for the details.

### Changes:
* Updates the README with details about temperature/humidity sensor interval polling and security system modes. (5d0d024)
* Updates the plugin's configuration instructions regarding the Security System modes for sensors and switches. (b724657)
* Code formatting cleanup. (bb8d0ee)
* Renames inbound sensor update payload variable to be more semantic. (0fde4aa)
* Code cleanup in the zone configuration with trigger object properties. (ac66208)
* UI X configuration schema grammar/formatting cleanup. (0301958)
* Removes warnings tracing from the node monitor config (which blocked debugging). (969e7f2)
* Removes panic button feature from list (there's already a switch for the siren - we can use that). (86eac32)
* Adds shopping discount message to the README for Konnected users. (6457c81)
* Fixes header splash image URL link to point to Konnected's main website with utm parameter for analytics. (e5bb9ad)
* Adjusts the messaging of the triggerable modes for switches in the plugin configuration screen in Config UI X. (1ca8e24)
* Creates constant for reverse constant lookup for future use. (ec8d20f)
* Interface object comments. (3181f12)
* Comment cleanup. Code cleanup. Method parameter reorganizing. Adjusts debug log assignment. (e198e9d)
* Renames zonesCheck variable to have more semantic existingPayloadZones meaning. (9ef778f)
* Removes unused code blocks and comments. (06b1733)
* Cleans up state values and assignment for momentary switches. (19c4b51)
* Removes redundant array variable and replaces with existing array with the same value(s). (ab5eec1)
* Removes redundant accessory UUID checks. Enforces state assignments to runtime cache for non security accessories. Enforces passed in accessory state as correct type. (cdd4a95)
* Refactors and merges the Security System controller method to include the trigger method - more logical. (7d5e0ed)
* Refactors switch trigger options to be more semantic. (9aa4e25)
* Fixes an issue with the reading of the config.json file when panels are found but don't have any zones assigned yet. (1c5eae5)

## [1.0.2](https://github.com/konnected-io/homebridge-konnected/compare/1.0.1...1.0.2) (2021-07-12)

Code cleanup, documentation cleanup, and minor non-showstopper changes.

# [1.0.1](https://github.com/konnected-io/homebridge-konnected/compare/0.1.2-beta...1.0.1) (2021-07-10)

Welcome to the official out-of-beta release of the Konnected Homebridge plugin for their Security Alarm Panels! 🎉🎉🎉

### ⚠️ Breaking Changes:
There have been slight changes to the config.json structure for this plugin. Please refer to the [README documentation](https://github.com/konnected-io/homebridge-konnected/blob/master/README.md) for the altered structure.

### Changes:
* Cleans up the package-lock file with updated packages. (955be4a)
* Fixes triggerable modes option in the example config.json in the README file. (c222f29)
* Merge branch 'master' of https://github.com/konnected-io/homebridge-konnected (b019d69)
* Rename on_pullRequest.yml to on_push-pullRequest.yml (c380af8)
* Update on_pullRequest.yml (ecf83ce)
* Updates the README with instructions and details for the new features in the latest update. (ac78207)
* Refactors, updates, adds, removes features, process, and logic required to provide a security system in HomeKit with Homebridge, this plugin and Konnected Alarm Panels. (7f370ae)
* Updates the interfaces for the different types common for this plugin's objects. (fe1c18e)
* Updates and refactors the constants based on changes in the main platform and platform accessory files. (6bb0018)
* Updates the npm package dependencies for this plugin. (cd4c252)
* Updates the Config UI X form schema.json file to include options for the new security system to operate beepers, sirens, and sensors. (5c8f195)
* Adds git documenting to the VS Code workspace settings. (13a7757)
* Adds warnings tracing to the node monitor config. (37e54a0)
* Updates debugging console to use an external terminal for multi-screen dev environments. (e030717)
* Updates TypeScript configuration. (e0c5ffb)
* Update and rename build.yml to on_pullRequest.yml (7485262)

## [0.1.2-beta](https://github.com/konnected-io/homebridge-konnected/compare/0.1.2...0.1.2-beta) (2021-01-28)

* Reinforcing correct zone state values and adds the ability to invert the value of a zone's state.
* Revises and makes debugging output more semantic.
* Adds a TypeScript interface for the zone states runtime cache commonly used throughout the code.
* Cleans up and renames the humidity / temperature sensor symbols.
* Code comment revisions.
* Readme cleanup.

## [0.1.2-beta.0](https://github.com/konnected-io/homebridge-konnected/compare/0.1.1-beta.0...0.1.2-beta.0) (2021-01-25)

Code cleanup, documentation cleanup, and minor non-showstopper changes.

## [0.1.1-beta.0](https://github.com/konnected-io/homebridge-konnected/compare/0.1.0-beta...0.1.1-beta.0) (2021-01-22)

Code cleanup, documentation cleanup, and minor non-showstopper changes.

## [0.1.0-beta](https://github.com/konnected-io/homebridge-konnected/compare/0.0.5-alpha...0.1.0-beta) (2021-01-20)

### Changes:
* Sensor support all available sensors provided by Konnected currently.
* Actuators, both stateful and momentary.
* Ability to remove, rename, add, and update zones as needed.
* Hints and Config UI X interface updates to make it easier to provision panels.

## [0.0.5-alpha](https://github.com/konnected-io/homebridge-konnected/compare/0.0.4-alpha...0.0.5-alpha) (2020-11-29)

### Changes:
* Panels can be discovered and provisioned.
* Panels are now populated in the Homebridge config.json based on their discovery.
* Config UI X has an interface that can add and assign* the zones which show up in HomeKit.

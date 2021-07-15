/**
 * For Pro Panel
 */
export const ZONES = {
  1:  ['sensor', 'beeper', 'siren', 'switch'],
  2:  ['sensor', 'beeper', 'siren', 'switch'],
  3:  ['sensor', 'beeper', 'siren', 'switch'],
  4:  ['sensor', 'beeper', 'siren', 'switch'],
  5:  ['sensor', 'beeper', 'siren', 'switch'],
  6:  ['sensor', 'beeper', 'siren', 'switch'],
  7:  ['sensor', 'beeper', 'siren', 'switch'],
  8:  ['sensor', 'beeper', 'siren', 'switch'],
  9:  ['sensor'],
  10: ['sensor'],
  11: ['sensor'],
  12: ['sensor'],
  alarm1:       ['beeper', 'siren', 'switch'],
  out1:         ['beeper', 'siren', 'switch'],
  alarm2_out2:  ['beeper', 'siren', 'switch'],
};

/**
 * For V1/V2 Panels
 */
export const ZONES_TO_PINS = {
  1: 1,
  2: 2,
  3: 5,
  4: 6,
  5: 7,
  6: 9,
  out: 8,
};

/**
 * For Zone Logic     
 */
export const ZONE_TYPES = {
  sensors: [
    'contact',
    'motion',
    'glass',
    'water',
    'smoke',
  ],
  dht_sensors: [
    'humidtemp',
  ],
  ds18b20_sensors: [
    'temperature',
  ],
  actuators: [
    'beeper',
    'siren',
    'strobe',
    'switch',
  ],
};

export const TYPES_TO_ACCESSORIES = {
  securitysystem: ['SecuritySystem',    'Security System'],               // https://developers.homebridge.io/#/service/SecuritySystem
  contact:        ['ContactSensor',     'Contact Sensor'],                // https://developers.homebridge.io/#/service/ContactSensor
  motion:         ['MotionSensor',      'Motion Sensor'],                 // https://developers.homebridge.io/#/service/MotionSensor
  glass:          ['ContactSensor',     'Glass Break Sensor'],            // https://developers.homebridge.io/#/service/ContactSensor
  water:          ['LeakSensor',        'Water Sensor'],                  // https://developers.homebridge.io/#/service/LeakSensor
  smoke:          ['SmokeSensor',       'Smoke Sensor'],                  // https://developers.homebridge.io/#/service/SmokeSensor
  temperature:    ['TemperatureSensor', 'Temperature Sensor'],            // https://developers.homebridge.io/#/service/TemperatureSensor
  humidtemp:      ['HumiditySensor',    'Humidity & Temperature Sensor'], // https://developers.homebridge.io/#/service/HumiditySensor
  beeper:         ['Switch',            'Beeper'],                        // https://developers.homebridge.io/#/service/Switch
  siren:          ['Switch',            'Siren'],                         // https://developers.homebridge.io/#/service/Switch
  strobe:         ['Switch',            'Strobe Light'],                  // https://developers.homebridge.io/#/service/Switch
  switch:         ['Switch',            'Generic Switch'],                // https://developers.homebridge.io/#/service/Switch
};

export const ALARM_NAMES_TO_NUMBERS = {
  STAY_ARM: 0,
  AWAY_ARM: 1,
  NIGHT_ARM: 2,
  DISARMED: 3,
  ALARM_TRIGGERED: 4,
};

export const ALARM_VALUES_TO_NAMES = (value: number) => {
  Object.entries(ALARM_NAMES_TO_NUMBERS).find(([name, number]) => {
    if (value === number) {
      return name;
    }
  });
};
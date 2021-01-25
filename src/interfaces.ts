import { PlatformConfig } from 'homebridge';

/**
 * Common object structure returned from the panels.
 */
export interface PanelObjectInterface {
  gw: string;
  nm: string;
  ip: string;
  port: number;
  mac: string;
  rssi: number;
  hwVersion: string;
  settings: {
    endpoint: string;
    endpoint_type: string;
  };
  uptime: number;
  swVersion: string;
  actuators: [];
  dht_sensors: [];
  ds18b20_sensors: [];
  sensors: [];
  heap: number;
  chipId?: string;
  model?: string;
  connection_type?: string;
}

/**
 * Common object structure for the Konnected platform Homebridge config.
 */
export interface ConfigPlatformInterface extends PlatformConfig {
  advanced?: {
    listenerPort?: number;
    listenerIP?: string;
    discoveryTimeout?: string;
  };
  panels?: Panel;
}

interface Panel {
  name?: string;
  uuid?: string;
  zones?: Zone;
}

interface Zone {
  zoneNumber?: number;
  zoneType?: string;
  zoneLocation?: string;
}

/**
 * Common object structure for the zone runtime cache.
 */
export interface ZoneStatesRuntimeCache {
  UUID: string;
  displayName: string;
  type: string;
  model: string;
  serialNumber: string;
  invert?: boolean;
  state?: number | boolean;
  temp?: number;
  humidity?: number;
  panel: PanelObjectInterface;
}
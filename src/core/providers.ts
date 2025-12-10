import * as vscode from 'vscode';

export type ProviderType = 'dns' | 'compute';

export interface IProvider {
  readonly id: string;
  readonly label: string;
  readonly type: ProviderType;
  isConfigured(): Promise<boolean>;
}

export interface DnsRecord {
  id: string;
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS' | 'CAA' | 'TLSA';
  name: string;
  value: string;
  ttl: number;
}

export interface Domain {
  id: string;
  name: string;
  records: DnsRecord[];
}

export interface IDnsProvider extends IProvider {
  listDomains(): Promise<Domain[]>;
  updateRecord(domainId: string, recordId: string, newValue: string, ttl?: number): Promise<void>;
}

export interface Server {
  id: string;
  name: string;
  status: 'running' | 'off' | 'migrating' | 'unknown' | 'initializing' | 'stopping' | 'starting' | 'deleting';
  publicIp?: string;
  project?: string;
}

export interface RescueModeResult {
  rootPassword: string;
}

export interface IComputeProvider extends IProvider {
  listProjects(): Promise<string[]>;
  listServers(project?: string): Promise<Server[]>;
  rebootServer(id: string): Promise<void>;
  powerOffServer(id: string): Promise<void>;
  enableRescueMode(id: string): Promise<RescueModeResult>;
  createSnapshot(id: string, name?: string): Promise<void>;
}

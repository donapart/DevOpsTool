/**
 * Google Cloud DNS Provider
 * 
 * API Documentation: https://cloud.google.com/dns/docs/reference/v1
 * 
 * Authentication: Service Account JSON Key (stored as base64)
 */

import { IDnsProvider, Domain, DnsRecord } from '../core/providers';
import { AccountManager, Account, AccountColorMap } from '../core/accounts';
import * as vscode from 'vscode';
import { SimpleCache } from '../util/cache';
import { logDebug, logInfo, logError } from '../util/logging';
import { AuthError, ApiError, isAuthError } from '../util/errors';

const TAG = 'Google-DNS';

export interface GoogleDomainWithAccount extends Domain {
  accountId: string;
  accountName: string;
  accountColor: string;
  projectId: string;
}

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

export class GoogleDnsProvider implements IDnsProvider {
  readonly id = 'google-dns';
  readonly label = 'Google Cloud DNS';
  readonly type = 'dns' as const;

  private cache = new SimpleCache<GoogleDomainWithAccount[]>(30000);
  private tokenCache = new Map<string, { token: string; expiry: number }>();

  constructor(
    private accountManager: AccountManager,
    private secrets: vscode.SecretStorage
  ) {}

  async isConfigured(): Promise<boolean> {
    return this.accountManager.hasAccountsForProvider('google-dns');
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  getAccounts(): Account[] {
    return this.accountManager.getByProvider('google-dns');
  }

  async listDomains(): Promise<GoogleDomainWithAccount[]> {
    const accounts = this.getAccounts();
    
    if (accounts.length === 0) {
      return [{
        id: '__no_account__',
        name: '⚠️ Kein Account konfiguriert',
        records: [],
        accountId: '',
        accountName: '',
        accountColor: '',
        projectId: ''
      }];
    }

    return this.cache.getOrFetch('all-domains', async () => {
      const allDomains: GoogleDomainWithAccount[] = [];

      for (const account of accounts) {
        try {
          const keyJson = await this.accountManager.getToken(account.id);
          if (!keyJson) continue;

          const domains = await this.fetchDomainsForAccount(account, keyJson);
          allDomains.push(...domains);
        } catch (err) {
          logError(TAG, `Failed to fetch domains for account ${account.name}`, err);
          allDomains.push({
            id: `__error_${account.id}__`,
            name: `❌ ${account.name}: Fehler beim Laden`,
            records: [],
            accountId: account.id,
            accountName: account.name,
            accountColor: AccountColorMap[account.color],
            projectId: ''
          });
        }
      }

      return allDomains;
    });
  }

  private async getAccessToken(keyJson: string): Promise<string> {
    // Check token cache
    const cached = this.tokenCache.get(keyJson);
    if (cached && cached.expiry > Date.now()) {
      return cached.token;
    }

    // Parse service account key
    let key: ServiceAccountKey;
    try {
      // Key might be base64 encoded
      const decoded = Buffer.from(keyJson, 'base64').toString('utf-8');
      key = JSON.parse(decoded.startsWith('{') ? decoded : keyJson);
    } catch {
      key = JSON.parse(keyJson);
    }

    // Create JWT for token request
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: key.token_uri,
      iat: now,
      exp: now + 3600
    };

    // Sign JWT (simplified - in production use a proper JWT library)
    const jwt = await this.createJwt(header, payload, key.private_key);

    // Exchange JWT for access token
    const response = await fetch(key.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!response.ok) {
      throw new AuthError('Google Cloud');
    }

    const data: any = await response.json();
    const token = data.access_token;

    // Cache token
    this.tokenCache.set(keyJson, {
      token,
      expiry: Date.now() + (data.expires_in - 60) * 1000
    });

    return token;
  }

  private async createJwt(header: any, payload: any, privateKey: string): Promise<string> {
    // Base64url encode header and payload
    const encodedHeader = this.base64urlEncode(JSON.stringify(header));
    const encodedPayload = this.base64urlEncode(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    // Sign with RSA-SHA256
    const crypto = await import('crypto');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = sign.sign(privateKey, 'base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    return `${signatureInput}.${signature}`;
  }

  private base64urlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  private async fetchDomainsForAccount(account: Account, keyJson: string): Promise<GoogleDomainWithAccount[]> {
    logInfo(TAG, `Fetching zones for account: ${account.name}`);

    // Parse key to get project ID
    let key: ServiceAccountKey;
    try {
      const decoded = Buffer.from(keyJson, 'base64').toString('utf-8');
      key = JSON.parse(decoded.startsWith('{') ? decoded : keyJson);
    } catch {
      key = JSON.parse(keyJson);
    }

    const projectId = key.project_id;
    const token = await this.getAccessToken(keyJson);

    // List managed zones
    const response = await fetch(
      `https://dns.googleapis.com/dns/v1/projects/${projectId}/managedZones`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      if (isAuthError(response.status)) {
        throw new AuthError('Google Cloud');
      }
      throw new ApiError('Google Cloud', response.status, response.statusText);
    }

    const data: any = await response.json();
    const zones = data.managedZones || [];
    logDebug(TAG, `Found ${zones.length} zones for ${account.name}`);

    // Fetch records for each zone in parallel
    const domainPromises = zones.map(async (zone: any) => {
      try {
        const recordsResponse = await fetch(
          `https://dns.googleapis.com/dns/v1/projects/${projectId}/managedZones/${zone.name}/rrsets`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );

        if (recordsResponse.ok) {
          const recordsData: any = await recordsResponse.json();
          const records: DnsRecord[] = (recordsData.rrsets || [])
            .filter((r: any) => ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'].includes(r.type))
            .map((r: any) => ({
              // Use '::' as separator to avoid conflicts with dashes in zone/record names
              id: `${zone.name}::${r.name}::${r.type}`,
              type: r.type,
              name: r.name.replace(`.${zone.dnsName}`, '').replace(/\.$/, '') || '@',
              value: r.rrdatas?.[0] || '',
              ttl: r.ttl
            }));

          return {
            id: zone.name,
            name: zone.dnsName.replace(/\.$/, ''),
            records,
            accountId: account.id,
            accountName: account.name,
            accountColor: AccountColorMap[account.color],
            projectId
          };
        }
      } catch (err) {
        logError(TAG, `Failed to fetch records for zone ${zone.name}`, err);
      }

      return {
        id: zone.name,
        name: zone.dnsName.replace(/\.$/, ''),
        records: [],
        accountId: account.id,
        accountName: account.name,
        accountColor: AccountColorMap[account.color],
        projectId
      };
    });

    return Promise.all(domainPromises);
  }

  async updateRecord(domainId: string, recordId: string, newValue: string, ttl?: number, accountId?: string): Promise<void> {
    const account = accountId
      ? this.accountManager.getById(accountId)
      : this.accountManager.getDefaultForProvider('google-dns');

    if (!account) throw new Error('Kein Account konfiguriert');

    const keyJson = await this.accountManager.getToken(account.id);
    if (!keyJson) throw new AuthError('Google Cloud');

    logInfo(TAG, `Updating record ${recordId} in zone ${domainId} (Account: ${account.name})`);

    // Parse record ID to get zone name, record name and type
    // Format: zoneName::recordName::recordType (using '::' separator to avoid conflicts with dashes)
    const parts = recordId.split('::');
    if (parts.length !== 3) {
      throw new Error(`Invalid record ID format: ${recordId}. Expected format: zoneName::recordName::recordType`);
    }
    const [zoneName, recordName, recordType] = parts;

    // Parse key to get project ID
    let key: ServiceAccountKey;
    try {
      const decoded = Buffer.from(keyJson, 'base64').toString('utf-8');
      key = JSON.parse(decoded.startsWith('{') ? decoded : keyJson);
    } catch {
      key = JSON.parse(keyJson);
    }

    const projectId = key.project_id;
    const token = await this.getAccessToken(keyJson);

    // Google Cloud DNS uses a "change" API for updates
    const change = {
      deletions: [],
      additions: [{
        name: recordName.endsWith('.') ? recordName : `${recordName}.`,
        type: recordType,
        ttl: ttl || 300,
        rrdatas: [newValue]
      }]
    };

    const response = await fetch(
      `https://dns.googleapis.com/dns/v1/projects/${projectId}/managedZones/${domainId}/changes`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(change)
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new ApiError('Google Cloud', response.status, response.statusText, err);
    }

    logInfo(TAG, `Record ${recordId} updated successfully`);
    this.invalidateCache();
  }
}

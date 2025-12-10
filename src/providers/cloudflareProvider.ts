/**
 * Cloudflare DNS Provider (Template)
 * 
 * API Documentation: https://developers.cloudflare.com/api/
 * 
 * TODO: Implement actual API calls
 */

import { IDnsProvider, Domain, DnsRecord } from '../core/providers';
import { AccountManager, Account, AccountColorMap } from '../core/accounts';
import * as vscode from 'vscode';
import { SimpleCache } from '../util/cache';
import { logDebug, logInfo, logError } from '../util/logging';
import { AuthError, ApiError, isAuthError } from '../util/errors';

const TAG = 'Cloudflare';

export interface CloudflareDomainWithAccount extends Domain {
  accountId: string;
  accountName: string;
  accountColor: string;
}

export class CloudflareProvider implements IDnsProvider {
  readonly id = 'cloudflare';
  readonly label = 'Cloudflare';
  readonly type = 'dns' as const;

  private cache = new SimpleCache<CloudflareDomainWithAccount[]>(30000);

  constructor(
    private accountManager: AccountManager,
    private secrets: vscode.SecretStorage
  ) {}

  async isConfigured(): Promise<boolean> {
    return this.accountManager.hasAccountsForProvider('cloudflare');
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  getAccounts(): Account[] {
    return this.accountManager.getByProvider('cloudflare');
  }

  async listDomains(): Promise<CloudflareDomainWithAccount[]> {
    const accounts = this.getAccounts();
    
    if (accounts.length === 0) {
      return [{
        id: '__no_account__',
        name: '⚠️ Kein Account konfiguriert',
        records: [],
        accountId: '',
        accountName: '',
        accountColor: ''
      }];
    }

    return this.cache.getOrFetch('all-domains', async () => {
      const allDomains: CloudflareDomainWithAccount[] = [];

      for (const account of accounts) {
        try {
          const token = await this.accountManager.getToken(account.id);
          if (!token) continue;

          const domains = await this.fetchDomainsForAccount(account, token);
          allDomains.push(...domains);
        } catch (err) {
          logError(TAG, `Failed to fetch domains for account ${account.name}`, err);
          allDomains.push({
            id: `__error_${account.id}__`,
            name: `❌ ${account.name}: Fehler beim Laden`,
            records: [],
            accountId: account.id,
            accountName: account.name,
            accountColor: AccountColorMap[account.color]
          });
        }
      }

      return allDomains;
    });
  }

  private async fetchDomainsForAccount(account: Account, token: string): Promise<CloudflareDomainWithAccount[]> {
    logInfo(TAG, `Fetching zones for account: ${account.name}`);

    // Cloudflare API: GET /zones
    const response = await fetch('https://api.cloudflare.com/client/v4/zones', { 
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      } 
    });

    if (!response.ok) {
      if (isAuthError(response.status)) {
        throw new AuthError('Cloudflare');
      }
      throw new ApiError('Cloudflare', response.status, response.statusText);
    }

    const data: any = await response.json();
    
    if (!data.success) {
      throw new Error(data.errors?.[0]?.message || 'Cloudflare API Error');
    }

    const zones = data.result || [];
    logDebug(TAG, `Found ${zones.length} zones for ${account.name}`);

    // Fetch records for each zone in parallel
    const domainPromises = zones.map(async (zone: any) => {
      try {
        const recordsResponse = await fetch(
          `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records`,
          {
            headers: { 
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            } 
          }
        );
        
        if (recordsResponse.ok) {
          const recordsData: any = await recordsResponse.json();
          const records: DnsRecord[] = (recordsData.result || []).map((r: any) => ({
            id: r.id,
            type: r.type,
            name: r.name.replace(`.${zone.name}`, '') || '@',
            value: r.content,
            ttl: r.ttl
          }));

          return {
            id: zone.id,
            name: zone.name,
            records,
            accountId: account.id,
            accountName: account.name,
            accountColor: AccountColorMap[account.color]
          };
        }
      } catch (err) {
        logError(TAG, `Failed to fetch records for zone ${zone.name}`, err);
      }
      
      return {
        id: zone.id,
        name: zone.name,
        records: [],
        accountId: account.id,
        accountName: account.name,
        accountColor: AccountColorMap[account.color]
      };
    });

    return Promise.all(domainPromises);
  }

  async updateRecord(domainId: string, recordId: string, newValue: string, ttl?: number, accountId?: string): Promise<void> {
    const account = accountId 
      ? this.accountManager.getById(accountId)
      : this.accountManager.getDefaultForProvider('cloudflare');
    
    if (!account) throw new Error('Kein Account konfiguriert');
    
    const token = await this.accountManager.getToken(account.id);
    if (!token) throw new AuthError('Cloudflare');

    logInfo(TAG, `Updating record ${recordId} in zone ${domainId} (Account: ${account.name})`);

    // Get current record
    const getRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${domainId}/dns_records/${recordId}`, 
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    if (!getRes.ok) {
      if (isAuthError(getRes.status)) {
        throw new AuthError('Cloudflare');
      }
      throw new ApiError('Cloudflare', getRes.status, getRes.statusText);
    }

    const recordData: any = await getRes.json();
    const currentRecord = recordData.result;

    // Update record
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${domainId}/dns_records/${recordId}`,
      {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: currentRecord.type,
          name: currentRecord.name,
          content: newValue,
          ttl: ttl || currentRecord.ttl,
          proxied: currentRecord.proxied
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new ApiError('Cloudflare', response.status, response.statusText, err);
    }

    logInfo(TAG, `Record ${recordId} updated successfully`);
    this.invalidateCache();
  }
}

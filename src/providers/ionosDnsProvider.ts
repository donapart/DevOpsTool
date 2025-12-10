import { IDnsProvider, Domain, DnsRecord } from '../core/providers';
import * as vscode from 'vscode';
import { SimpleCache } from '../util/cache';
import { logDebug, logInfo, logError } from '../util/logging';
import { AuthError, ApiError, isAuthError } from '../util/errors';

const TAG = 'IONOS-DNS';

export class IonosDnsProvider implements IDnsProvider {
  readonly id = 'ionos-dns';
  readonly label = 'IONOS DNS';
  readonly type = 'dns' as const;

  private cache = new SimpleCache<Domain[]>(30000); // 30s TTL

  constructor(private secrets: vscode.SecretStorage) {}

  async isConfigured(): Promise<boolean> {
    const token = await this.secrets.get('ionos.dns.token');
    return !!token;
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  async listDomains(): Promise<Domain[]> {
    const token = await this.secrets.get('ionos.dns.token');
    
    if (!token) {
      logDebug(TAG, 'No token configured, returning empty state');
      return [{
        id: '__no_token__',
        name: '⚠️ Token nicht konfiguriert',
        records: []
      }];
    }

    return this.cache.getOrFetch('domains', async () => {
      logInfo(TAG, 'Fetching domains from API...');
      
      const response = await fetch('https://api.hosting.ionos.com/dns/v1/zones', { 
        headers: { 
          'X-API-Key': token,
          'Accept': 'application/json'
        } 
      });

      if (!response.ok) {
        if (isAuthError(response.status)) {
          throw new AuthError('IONOS');
        }
        throw new ApiError('IONOS', response.status, response.statusText);
      }

      const zones: any[] = await response.json() as any[];
      logDebug(TAG, `Found ${zones.length} zones`);

      // Parallel fetch of all zone details
      const domainPromises = zones.map(async (zone) => {
        try {
          const recordsResponse = await fetch(
            `https://api.hosting.ionos.com/dns/v1/zones/${zone.id}`,
            {
              headers: { 
                'X-API-Key': token,
                'Accept': 'application/json'
              } 
            }
          );
          
          if (recordsResponse.ok) {
            const zoneDetails: any = await recordsResponse.json();
            const records: DnsRecord[] = (zoneDetails.records || []).map((r: any) => ({
              id: r.id,
              type: r.type,
              name: r.name || '@',
              value: r.content,
              ttl: r.ttl
            }));

            return {
              id: zone.id,
              name: zone.name,
              records
            };
          }
        } catch (err) {
          logError(TAG, `Failed to fetch records for zone ${zone.name}`, err);
        }
        
        return {
          id: zone.id,
          name: zone.name,
          records: []
        };
      });

      const domains = await Promise.all(domainPromises);
      logInfo(TAG, `Loaded ${domains.length} domains with records`);
      return domains;
    });
  }

  async updateRecord(domainId: string, recordId: string, newValue: string, ttl?: number): Promise<void> {
    const token = await this.secrets.get('ionos.dns.token');
    if (!token) throw new AuthError('IONOS');

    logInfo(TAG, `Updating record ${recordId} in zone ${domainId} to ${newValue}`);

    // Fetch current record
    const getRes = await fetch(
      `https://api.hosting.ionos.com/dns/v1/zones/${domainId}/records/${recordId}`, 
      { headers: { 'X-API-Key': token } }
    );
    
    if (!getRes.ok) {
      if (isAuthError(getRes.status)) {
        throw new AuthError('IONOS');
      }
      throw new ApiError('IONOS', getRes.status, getRes.statusText);
    }

    const currentRecord: any = await getRes.json();

    const updatePayload = {
      name: currentRecord.name,
      type: currentRecord.type,
      content: newValue,
      ttl: ttl || currentRecord.ttl,
      prio: currentRecord.prio
    };

    const response = await fetch(
      `https://api.hosting.ionos.com/dns/v1/zones/${domainId}/records/${recordId}`,
      {
        method: 'PUT',
        headers: { 
          'X-API-Key': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatePayload)
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new ApiError('IONOS', response.status, response.statusText, err);
    }

    logInfo(TAG, `Record ${recordId} updated successfully`);
    this.invalidateCache();
  }

  async setRecordTtl(domainId: string, recordId: string, ttl: number): Promise<void> {
    const token = await this.secrets.get('ionos.dns.token');
    if (!token) throw new AuthError('IONOS');

    logInfo(TAG, `Setting TTL for record ${recordId} to ${ttl}s`);

    const getRes = await fetch(
      `https://api.hosting.ionos.com/dns/v1/zones/${domainId}/records/${recordId}`, 
      { headers: { 'X-API-Key': token } }
    );
    
    if (!getRes.ok) {
      throw new ApiError('IONOS', getRes.status, getRes.statusText);
    }

    const currentRecord: any = await getRes.json();

    const updatePayload = {
      name: currentRecord.name,
      type: currentRecord.type,
      content: currentRecord.content,
      ttl: ttl,
      prio: currentRecord.prio
    };

    const response = await fetch(
      `https://api.hosting.ionos.com/dns/v1/zones/${domainId}/records/${recordId}`,
      {
        method: 'PUT',
        headers: { 
          'X-API-Key': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatePayload)
      }
    );

    if (!response.ok) {
      throw new ApiError('IONOS', response.status, response.statusText);
    }

    this.invalidateCache();
  }
}

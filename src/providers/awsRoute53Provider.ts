/**
 * AWS Route 53 DNS Provider
 * 
 * API Documentation: https://docs.aws.amazon.com/Route53/latest/APIReference/
 * 
 * Authentication: Access Key ID + Secret Access Key (stored as "keyId:secretKey")
 */

import { IDnsProvider, Domain, DnsRecord } from '../core/providers';
import { AccountManager, Account, AccountColorMap } from '../core/accounts';
import * as vscode from 'vscode';
import { SimpleCache } from '../util/cache';
import { logDebug, logInfo, logError } from '../util/logging';
import { AuthError, ApiError, isAuthError } from '../util/errors';

const TAG = 'AWS-Route53';

export interface AwsDomainWithAccount extends Domain {
  accountId: string;
  accountName: string;
  accountColor: string;
  hostedZoneId: string;
}

export class AwsRoute53Provider implements IDnsProvider {
  readonly id = 'aws-route53';
  readonly label = 'AWS Route 53';
  readonly type = 'dns' as const;

  private cache = new SimpleCache<AwsDomainWithAccount[]>(30000);

  constructor(
    private accountManager: AccountManager,
    private secrets: vscode.SecretStorage
  ) {}

  async isConfigured(): Promise<boolean> {
    return this.accountManager.hasAccountsForProvider('aws-route53');
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  getAccounts(): Account[] {
    return this.accountManager.getByProvider('aws-route53');
  }

  async listDomains(): Promise<AwsDomainWithAccount[]> {
    const accounts = this.getAccounts();
    
    if (accounts.length === 0) {
      return [{
        id: '__no_account__',
        name: '⚠️ Kein Account konfiguriert',
        records: [],
        accountId: '',
        accountName: '',
        accountColor: '',
        hostedZoneId: ''
      }];
    }

    return this.cache.getOrFetch('all-domains', async () => {
      const allDomains: AwsDomainWithAccount[] = [];

      for (const account of accounts) {
        try {
          const credentials = await this.accountManager.getToken(account.id);
          if (!credentials) continue;

          const domains = await this.fetchDomainsForAccount(account, credentials);
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
            hostedZoneId: ''
          });
        }
      }

      return allDomains;
    });
  }

  private parseCredentials(credentials: string): { accessKeyId: string; secretAccessKey: string } {
    const [accessKeyId, secretAccessKey] = credentials.split(':');
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Invalid AWS credentials format. Expected: accessKeyId:secretAccessKey');
    }
    return { accessKeyId, secretAccessKey };
  }

  private async signRequest(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string,
    accessKeyId: string,
    secretAccessKey: string
  ): Promise<Record<string, string>> {
    const crypto = await import('crypto');
    
    const parsedUrl = new URL(url);
    const host = parsedUrl.host;
    const path = parsedUrl.pathname + parsedUrl.search;
    const service = 'route53';
    const region = 'us-east-1'; // Route 53 is global, uses us-east-1
    
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    // Create canonical request
    const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-date';
    const payloadHash = crypto.createHash('sha256').update(body || '').digest('hex');
    
    const canonicalRequest = [
      method,
      path || '/',
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');

    // Create string to sign
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n');

    // Calculate signature
    const getSignatureKey = (key: string, dateStamp: string, regionName: string, serviceName: string): Buffer => {
      const kDate = crypto.createHmac('sha256', `AWS4${key}`).update(dateStamp).digest();
      const kRegion = crypto.createHmac('sha256', kDate as any).update(regionName).digest();
      const kService = crypto.createHmac('sha256', kRegion as any).update(serviceName).digest();
      const kSigning = crypto.createHmac('sha256', kService as any).update('aws4_request').digest();
      return kSigning;
    };

    const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
    const signature = crypto.createHmac('sha256', signingKey as any).update(stringToSign).digest('hex');

    // Create authorization header
    const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...headers,
      'Host': host,
      'X-Amz-Date': amzDate,
      'Authorization': authorization
    };
  }

  private async fetchDomainsForAccount(account: Account, credentials: string): Promise<AwsDomainWithAccount[]> {
    logInfo(TAG, `Fetching hosted zones for account: ${account.name}`);

    const { accessKeyId, secretAccessKey } = this.parseCredentials(credentials);
    const url = 'https://route53.amazonaws.com/2013-04-01/hostedzone';

    const headers = await this.signRequest('GET', url, {}, '', accessKeyId, secretAccessKey);

    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (isAuthError(response.status)) {
        throw new AuthError('AWS Route 53');
      }
      throw new ApiError('AWS Route 53', response.status, response.statusText);
    }

    const text = await response.text();
    // Parse XML response (simplified - in production use a proper XML parser)
    const zones = this.parseHostedZonesXml(text);
    logDebug(TAG, `Found ${zones.length} hosted zones for ${account.name}`);

    // Fetch records for each zone
    const domainPromises = zones.map(async (zone) => {
      try {
        const recordsUrl = `https://route53.amazonaws.com/2013-04-01/hostedzone/${zone.id}/rrset`;
        const recordHeaders = await this.signRequest('GET', recordsUrl, {}, '', accessKeyId, secretAccessKey);

        const recordsResponse = await fetch(recordsUrl, { headers: recordHeaders });

        if (recordsResponse.ok) {
          const recordsText = await recordsResponse.text();
          const records = this.parseRecordSetsXml(recordsText, zone.name);

          return {
            id: zone.id,
            name: zone.name.replace(/\.$/, ''),
            records,
            accountId: account.id,
            accountName: account.name,
            accountColor: AccountColorMap[account.color],
            hostedZoneId: zone.id
          };
        }
      } catch (err) {
        logError(TAG, `Failed to fetch records for zone ${zone.name}`, err);
      }

      return {
        id: zone.id,
        name: zone.name.replace(/\.$/, ''),
        records: [],
        accountId: account.id,
        accountName: account.name,
        accountColor: AccountColorMap[account.color],
        hostedZoneId: zone.id
      };
    });

    return Promise.all(domainPromises);
  }

  private parseHostedZonesXml(xml: string): Array<{ id: string; name: string }> {
    const zones: Array<{ id: string; name: string }> = [];
    const zoneRegex = /<HostedZone>[\s\S]*?<Id>\/hostedzone\/(.*?)<\/Id>[\s\S]*?<Name>(.*?)<\/Name>[\s\S]*?<\/HostedZone>/g;
    
    let match;
    while ((match = zoneRegex.exec(xml)) !== null) {
      zones.push({ id: match[1], name: match[2] });
    }
    
    return zones;
  }

  private parseRecordSetsXml(xml: string, zoneName: string): DnsRecord[] {
    const records: DnsRecord[] = [];
    const recordRegex = /<ResourceRecordSet>[\s\S]*?<Name>(.*?)<\/Name>[\s\S]*?<Type>(.*?)<\/Type>[\s\S]*?<TTL>(.*?)<\/TTL>[\s\S]*?<ResourceRecords>([\s\S]*?)<\/ResourceRecords>[\s\S]*?<\/ResourceRecordSet>/g;
    
    const supportedTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];
    let match;
    
    while ((match = recordRegex.exec(xml)) !== null) {
      const type = match[2];
      if (!supportedTypes.includes(type)) continue;

      const valueMatch = /<Value>(.*?)<\/Value>/.exec(match[4]);
      const value = valueMatch ? valueMatch[1] : '';

      records.push({
        id: `${match[1]}-${type}`,
        type: type as DnsRecord['type'],
        name: match[1].replace(zoneName, '').replace(/\.$/, '') || '@',
        value,
        ttl: parseInt(match[3], 10)
      });
    }

    return records;
  }

  async updateRecord(domainId: string, recordId: string, newValue: string, ttl?: number, accountId?: string): Promise<void> {
    const account = accountId
      ? this.accountManager.getById(accountId)
      : this.accountManager.getDefaultForProvider('aws-route53');

    if (!account) throw new Error('Kein Account konfiguriert');

    const credentials = await this.accountManager.getToken(account.id);
    if (!credentials) throw new AuthError('AWS Route 53');

    logInfo(TAG, `Updating record ${recordId} in zone ${domainId} (Account: ${account.name})`);

    const { accessKeyId, secretAccessKey } = this.parseCredentials(credentials);

    // Parse record ID to get name and type
    const lastDash = recordId.lastIndexOf('-');
    const recordName = recordId.substring(0, lastDash);
    const recordType = recordId.substring(lastDash + 1);

    // Build change batch XML
    const changeXml = `<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeBatch>
    <Changes>
      <Change>
        <Action>UPSERT</Action>
        <ResourceRecordSet>
          <Name>${recordName}</Name>
          <Type>${recordType}</Type>
          <TTL>${ttl || 300}</TTL>
          <ResourceRecords>
            <ResourceRecord>
              <Value>${newValue}</Value>
            </ResourceRecord>
          </ResourceRecords>
        </ResourceRecordSet>
      </Change>
    </Changes>
  </ChangeBatch>
</ChangeResourceRecordSetsRequest>`;

    const url = `https://route53.amazonaws.com/2013-04-01/hostedzone/${domainId}/rrset`;
    const headers = await this.signRequest('POST', url, {
      'Content-Type': 'application/xml'
    }, changeXml, accessKeyId, secretAccessKey);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: changeXml
    });

    if (!response.ok) {
      const err = await response.text();
      throw new ApiError('AWS Route 53', response.status, response.statusText, err);
    }

    logInfo(TAG, `Record ${recordId} updated successfully`);
    this.invalidateCache();
  }
}

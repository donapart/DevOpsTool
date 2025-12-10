import { logDebug, logInfo, logError } from './logging';

const TAG = 'Propagation';

interface PropagationResult {
    server: string;
    ip: string | null;
    success: boolean;
}

/**
 * Checks DNS propagation using public DNS servers.
 * Uses DNS-over-HTTPS (DoH) for simple HTTP-based queries.
 */
export async function checkDnsPropagation(domain: string, recordName: string, expectedValue: string): Promise<PropagationResult[]> {
    const dnsServers = [
        { name: 'Google', url: 'https://dns.google/resolve' },
        { name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
        { name: 'Quad9', url: 'https://dns.quad9.net:5053/dns-query' }
    ];

    const fullDomain = recordName === '@' ? domain : `${recordName}.${domain}`;
    logInfo(TAG, `Checking propagation for ${fullDomain} (expected: ${expectedValue})`);

    const results: PropagationResult[] = [];

    for (const dns of dnsServers) {
        try {
            const response = await fetch(`${dns.url}?name=${encodeURIComponent(fullDomain)}&type=A`, {
                headers: {
                    'Accept': 'application/dns-json'
                }
            });

            if (response.ok) {
                const data: any = await response.json();
                const answers = data.Answer || [];
                const aRecord = answers.find((a: any) => a.type === 1); // Type 1 = A record
                const ip = aRecord?.data || null;
                const success = ip === expectedValue;

                logDebug(TAG, `${dns.name}: ${ip} (${success ? 'MATCH' : 'NO MATCH'})`);
                results.push({ server: dns.name, ip, success });
            } else {
                results.push({ server: dns.name, ip: null, success: false });
            }
        } catch (err) {
            logError(TAG, `Failed to query ${dns.name}`, err);
            results.push({ server: dns.name, ip: null, success: false });
        }
    }

    return results;
}

/**
 * Formats propagation results for display.
 */
export function formatPropagationResults(results: PropagationResult[], expectedValue: string): string {
    const lines = results.map(r => {
        const icon = r.success ? '✅' : r.ip ? '⚠️' : '❌';
        const value = r.ip || 'nicht gefunden';
        return `${icon} ${r.server}: ${value}`;
    });

    const allMatch = results.every(r => r.success);
    const summary = allMatch 
        ? '🎉 DNS ist vollständig propagiert!' 
        : `⏳ Noch nicht überall propagiert (erwartet: ${expectedValue})`;

    return `${summary}\n\n${lines.join('\n')}`;
}

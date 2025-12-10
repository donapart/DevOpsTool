import { IProvider, IDnsProvider, IComputeProvider } from '../core/providers';

/**
 * Type guard to check if a provider is a DNS provider.
 */
export function isDnsProvider(provider: IProvider | undefined): provider is IDnsProvider {
    return provider !== undefined && provider.type === 'dns' && 'listDomains' in provider && 'updateRecord' in provider;
}

/**
 * Type guard to check if a provider is a Compute provider.
 */
export function isComputeProvider(provider: IProvider | undefined): provider is IComputeProvider {
    return provider !== undefined && provider.type === 'compute' && 'listServers' in provider && 'rebootServer' in provider;
}

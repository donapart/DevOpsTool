import { IDnsProvider, IComputeProvider } from './providers';

export class ProviderManager {
  private dnsProviders: IDnsProvider[] = [];
  private computeProviders: IComputeProvider[] = [];

  registerDnsProvider(provider: IDnsProvider) {
    this.dnsProviders.push(provider);
  }

  registerComputeProvider(provider: IComputeProvider) {
    this.computeProviders.push(provider);
  }

  getDnsProviders(): IDnsProvider[] {
    return this.dnsProviders;
  }

  getComputeProviders(): IComputeProvider[] {
    return this.computeProviders;
  }

  getProviderById(id: string): IDnsProvider | IComputeProvider | undefined {
    return [...this.dnsProviders, ...this.computeProviders].find(p => p.id === id);
  }
}

import { AdminBlockchainService } from './admin-blockchain.service';
import * as compliance from '../common/onchain-compliance';

describe('AdminBlockchainService (Issue #210)', () => {
  let service: AdminBlockchainService;

  beforeEach(() => {
    service = new AdminBlockchainService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('includes complianceHealth in status report when contract is healthy', async () => {
    jest.spyOn((service as any).horizon, 'loadAccount').mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '100' }],
    });
    jest.spyOn((service as any).rpcServer, 'getLatestLedger').mockResolvedValue({
      sequence: 123456,
    });
    jest.spyOn(compliance, 'checkComplianceContractHealth').mockResolvedValue({
      healthy: true,
      initialized: true,
      canaryAddress: 'GCANARY123',
      canaryAllowed: false,
      alert: null,
      latencyMs: 15,
    });

    const status = await service.status();

    expect(status.network).toBe('testnet');
    expect(status.facilitator.reachable).toBe(true);
    expect(status.complianceHealth.healthy).toBe(true);
    expect(status.complianceHealth.initialized).toBe(true);
    expect(status.complianceHealth.alert).toBeNull();
  });

  it('produces durable alert in status report when compliance contract is uninitialized', async () => {
    jest.spyOn((service as any).horizon, 'loadAccount').mockResolvedValue({
      balances: [],
    });
    jest.spyOn((service as any).rpcServer, 'getLatestLedger').mockResolvedValue({
      sequence: 123456,
    });
    jest.spyOn(compliance, 'checkComplianceContractHealth').mockResolvedValue({
      healthy: false,
      initialized: false,
      canaryAddress: 'GCANARY123',
      canaryAllowed: true,
      alert: '[CRITICAL COMPLIANCE ALERT] Compliance contract returned allowed=true for canary address',
      latencyMs: 20,
    });

    const status = await service.status();

    expect(status.complianceHealth.healthy).toBe(false);
    expect(status.complianceHealth.initialized).toBe(false);
    expect(status.complianceHealth.alert).toContain('[CRITICAL COMPLIANCE ALERT]');
  });
});

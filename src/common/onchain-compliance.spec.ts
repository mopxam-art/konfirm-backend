import {
  isAllowedOnChain,
  checkComplianceContractHealth,
  setComplianceClientForTesting,
  resetComplianceClientForTesting,
  DEFAULT_CANARY_BLOCKED_ADDRESS,
} from './onchain-compliance';

describe('onchain-compliance & canary health verification (Issue #210)', () => {
  afterEach(() => {
    resetComplianceClientForTesting();
    jest.restoreAllMocks();
  });

  describe('checkComplianceContractHealth', () => {
    it('reports healthy when the canary address is correctly blocked on-chain', async () => {
      const mockClient = {
        is_allowed: jest.fn().mockResolvedValue({ result: false }),
      };
      setComplianceClientForTesting(mockClient as any);

      const result = await checkComplianceContractHealth();

      expect(result.healthy).toBe(true);
      expect(result.initialized).toBe(true);
      expect(result.canaryAllowed).toBe(false);
      expect(result.alert).toBeNull();
      expect(mockClient.is_allowed).toHaveBeenCalledWith({ addr: DEFAULT_CANARY_BLOCKED_ADDRESS });
    });

    it('detects an uninitialized compliance contract when canary returns true', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mockClient = {
        // An uninitialized contract returns true for all unrecorded addresses
        is_allowed: jest.fn().mockResolvedValue({ result: true }),
      };
      setComplianceClientForTesting(mockClient as any);

      const result = await checkComplianceContractHealth();

      expect(result.healthy).toBe(false);
      expect(result.initialized).toBe(false);
      expect(result.canaryAllowed).toBe(true);
      expect(result.alert).toContain('[CRITICAL COMPLIANCE ALERT]');
      expect(result.alert).toContain('almost certainly UNINITIALIZED');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('supports custom canary addresses for staging/testnet environments', async () => {
      const customCanary = 'GAAACUSTOMCANARYADDRESSFORCOMPLIANCECHECK1234567890';
      const mockClient = {
        is_allowed: jest.fn().mockResolvedValue({ result: false }),
      };
      setComplianceClientForTesting(mockClient as any);

      const result = await checkComplianceContractHealth(customCanary);

      expect(result.healthy).toBe(true);
      expect(result.canaryAddress).toBe(customCanary);
      expect(mockClient.is_allowed).toHaveBeenCalledWith({ addr: customCanary });
    });

    it('handles RPC errors gracefully and records failure alert without crashing', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const mockClient = {
        is_allowed: jest.fn().mockRejectedValue(new Error('RPC Connection Refused')),
      };
      setComplianceClientForTesting(mockClient as any);

      const result = await checkComplianceContractHealth();

      expect(result.healthy).toBe(false);
      expect(result.initialized).toBe(false);
      expect(result.canaryAllowed).toBeNull();
      expect(result.alert).toContain('[COMPLIANCE WARNING]');
      expect(result.alert).toContain('RPC Connection Refused');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('measures execution latency accurately', async () => {
      const mockClient = {
        is_allowed: jest.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 10));
          return { result: false };
        }),
      };
      setComplianceClientForTesting(mockClient as any);

      const result = await checkComplianceContractHealth();

      expect(result.latencyMs).toBeGreaterThanOrEqual(5);
    });
  });

  describe('isAllowedOnChain', () => {
    it('returns true when client clears the address', async () => {
      const mockClient = {
        is_allowed: jest.fn().mockResolvedValue({ result: true }),
      };
      setComplianceClientForTesting(mockClient as any);

      const allowed = await isAllowedOnChain('GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H');
      expect(allowed).toBe(true);
    });

    it('returns false when client explicitly blocks the address', async () => {
      const mockClient = {
        is_allowed: jest.fn().mockResolvedValue({ result: false }),
      };
      setComplianceClientForTesting(mockClient as any);

      const allowed = await isAllowedOnChain('GBLOCKEDADDRESS1234567890');
      expect(allowed).toBe(false);
    });

    it('fails open on RPC exception as documented to avoid blocking valid payments', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const mockClient = {
        is_allowed: jest.fn().mockRejectedValue(new Error('Timeout 8000ms reached')),
      };
      setComplianceClientForTesting(mockClient as any);

      const allowed = await isAllowedOnChain('GANYADDRESS123');
      expect(allowed).toBe(true);
    });
  });

  describe('concurrency and stress', () => {
    it('handles 25 concurrent health and check queries without race conditions', async () => {
      const mockClient = {
        is_allowed: jest.fn().mockImplementation(async ({ addr }: { addr: string }) => {
          return { result: addr !== DEFAULT_CANARY_BLOCKED_ADDRESS };
        }),
      };
      setComplianceClientForTesting(mockClient as any);

      const healthPromises = Array.from({ length: 15 }, () => checkComplianceContractHealth());
      const checkPromises = Array.from({ length: 10 }, (_, i) => isAllowedOnChain(`GUSER${i}`));

      const [healthResults, checkResults] = await Promise.all([
        Promise.all(healthPromises),
        Promise.all(checkPromises),
      ]);

      expect(healthResults).toHaveLength(15);
      healthResults.forEach((h) => expect(h.healthy).toBe(true));

      expect(checkResults).toHaveLength(10);
      checkResults.forEach((c) => expect(c).toBe(true));
    });
  });
});

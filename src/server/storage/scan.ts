/**
 * Virus/malware scan before a proof is stored and made viewable (FR-SEC-23). Behind a
 * provider interface with a pass-through dev implementation; Phase 12 wires a real
 * scanner (ClamAV / cloud) at the TODO-INTEGRATION marker.
 */
export interface ScanResult {
  clean: boolean;
  status: string; // stored on PaymentProof.virusScanStatus
}

export interface ScanProvider {
  readonly name: string;
  scan(bytes: Uint8Array): Promise<ScanResult>;
}

class PassThroughScanProvider implements ScanProvider {
  readonly name = "passthrough";
  async scan(bytes: Uint8Array): Promise<ScanResult> {
    // TODO-INTEGRATION (Phase 12): stream `bytes` to the malware scanner and map the
    // verdict. The dev provider treats every file as clean.
    void bytes;
    return { clean: true, status: "CLEAN" };
  }
}

let provider: ScanProvider | null = null;
export function getScanProvider(): ScanProvider {
  if (!provider) provider = new PassThroughScanProvider();
  return provider;
}

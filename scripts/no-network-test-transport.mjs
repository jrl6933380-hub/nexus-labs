// Test-only guard: unexpected real requests are blocked before leaving the process.
globalThis.fetch=async()=>{throw new Error('External requests are disabled in the isolated launch checks. Inject a test transport.');};

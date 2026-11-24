export function requireIsolatedDatabase(value: string | undefined): string {
 if (!value) throw new Error('Isolated database URL is required');
 const url=new URL(value);
 if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname!=='127.0.0.1' || !/^semitrax_test_[a-f0-9]{16}$/.test(url.pathname.slice(1)) || !url.port || url.port==='5432' || process.env.SEMITRAX_ISOLATED_DATABASE!==url.pathname.slice(1)) throw new Error('Database tests require the disposable loopback cluster created by the test runner');
 return value;
}

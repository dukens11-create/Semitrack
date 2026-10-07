import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/models/copilot_device_license.dart';

void main() {
  test('builds exact case-sensitive Trimble activation parameters', () {
    final uri = CoPilotDeviceLicense(companyId: ' company ', assetId: 'device-1').activationUri;
    expect(uri.scheme, 'copilot');
    expect(uri.host, 'options');
    expect(uri.queryParameters, {
      'type': 'CONFIG', 'CompanyID': 'company',
      'AssetID': 'device-1', 'showconfirmation': 'true',
    });
  });
  test('encodes IDs without injecting additional activation parameters', () {
    final uri = CoPilotDeviceLicense(companyId: 'company', assetId: 'device&ProductKey=other').activationUri;
    expect(uri.queryParameters['AssetID'], 'device&ProductKey=other');
    expect(uri.queryParameters.containsKey('ProductKey'), false);
  });
  test('rejects blank IDs and control characters', () {
    for (final id in ['', '   ', 'device\nother']) {
      expect(() => CoPilotDeviceLicense(companyId: 'company', assetId: id), throwsFormatException);
      expect(() => CoPilotDeviceLicense(companyId: id, assetId: 'device'), throwsFormatException);
    }
  });
}

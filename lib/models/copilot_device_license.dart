/// Device-specific identifiers assigned in Trimble Account Manager.
/// Never distribute one asset ID to multiple installations.
class CoPilotDeviceLicense {
  CoPilotDeviceLicense({required String companyId, required String assetId})
      : companyId = companyId.trim(),
        assetId = assetId.trim() {
    if (this.companyId.isEmpty || this.assetId.isEmpty ||
        this.companyId.contains(RegExp(r'[\x00-\x1f\x7f]')) ||
        this.assetId.contains(RegExp(r'[\x00-\x1f\x7f]'))) {
      throw const FormatException('Enter valid company and device IDs.');
    }
  }

  final String companyId;
  final String assetId;

  Uri get activationUri => Uri(
        scheme: 'copilot',
        host: 'options',
        queryParameters: {
          'type': 'CONFIG',
          'CompanyID': companyId,
          'AssetID': assetId,
          'showconfirmation': 'true',
        },
      );
}

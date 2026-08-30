class SubscriptionPlan {
  const SubscriptionPlan({
    required this.code,
    required this.displayName,
    required this.purpose,
    required this.description,
    required this.priceAmountCents,
    required this.currency,
    required this.billingInterval,
    required this.trialDays,
    required this.isActive,
    required this.isFeatured,
    required this.badge,
    required this.sortOrder,
  });

  final String code;
  final String displayName;
  final String purpose;
  final String? description;
  final int? priceAmountCents;
  final String currency;
  final String billingInterval;
  final int trialDays;
  final bool isActive;
  final bool isFeatured;
  final String? badge;
  final int sortOrder;

  factory SubscriptionPlan.fromJson(Map<String, dynamic> json) {
    return SubscriptionPlan(
      code: json['code']?.toString() ?? '',
      displayName: json['displayName']?.toString() ?? '',
      purpose: json['purpose']?.toString() ?? '',
      description: json['description']?.toString(),
      priceAmountCents: (json['priceAmountCents'] as num?)?.toInt(),
      currency: json['currency']?.toString() ?? 'USD',
      billingInterval: json['billingInterval']?.toString() ?? 'CUSTOM',
      trialDays: (json['trialDays'] as num?)?.toInt() ?? 0,
      isActive: json['isActive'] == true,
      isFeatured: json['isFeatured'] == true,
      badge: json['badge']?.toString(),
      sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
    );
  }

  String get priceLabel {
    if (priceAmountCents == null) return 'Custom';
    final cents = priceAmountCents!;
    return '\$${(cents / 100).toStringAsFixed(2)}';
  }

  String get cadenceLabel => switch (billingInterval) {
    'TRIAL' => trialDays == 1 ? 'for 1 day' : 'for $trialDays days',
    'MONTH' => '/ month',
    'YEAR' => '/ year',
    _ => 'per driver / truck',
  };

  String get actionLabel => switch (billingInterval) {
    'TRIAL' => 'Start free trial',
    'MONTH' => 'Choose monthly',
    'YEAR' => 'Choose annual',
    _ => 'Contact fleet sales',
  };
}

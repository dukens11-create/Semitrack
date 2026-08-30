import 'package:flutter/foundation.dart';

import '../core/api_client.dart';
import '../models/subscription_plan.dart';

class SubscriptionPlanService extends ChangeNotifier {
  SubscriptionPlanService(this.api);

  final ApiClient api;
  List<SubscriptionPlan> plans = const [];
  bool loading = false;
  String? error;

  Future<void> load() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final response = await api.getJson('/subscription-plans');
      final rawPlans = response['plans'];
      final parsedPlans = rawPlans is List
          ? rawPlans
                .whereType<Map>()
                .map(
                  (value) => SubscriptionPlan.fromJson(
                    Map<String, dynamic>.from(value),
                  ),
                )
                .toList()
          : <SubscriptionPlan>[];
      parsedPlans.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      plans = parsedPlans;
    } on ApiException catch (exception) {
      error = exception.message;
    } catch (_) {
      error = 'Unable to load current SemiTraX plans.';
    } finally {
      loading = false;
      notifyListeners();
    }
  }
}

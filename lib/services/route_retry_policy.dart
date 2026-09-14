import 'dart:math' as math;

class RouteRetryPolicy {
  const RouteRetryPolicy({this.maxAttempts = 3, this.baseDelay = const Duration(milliseconds: 500), this.maxDelay = const Duration(seconds: 5)});
  final int maxAttempts;
  final Duration baseDelay;
  final Duration maxDelay;

  bool canRetry({required int attempt, required int? statusCode}) {
    if (attempt >= maxAttempts) return false;
    if (statusCode == null) return true;
    return statusCode == 408 || statusCode == 429 || statusCode >= 500;
  }

  Duration delayFor({required int attempt, Duration? retryAfter, int jitterMillis = 0}) {
    if (retryAfter != null && retryAfter > Duration.zero) return retryAfter > maxDelay ? maxDelay : retryAfter;
    final exponent = math.max(0, attempt - 1);
    final ms = baseDelay.inMilliseconds * math.pow(2, exponent).toInt() + math.max(0, jitterMillis);
    return Duration(milliseconds: math.min(ms, maxDelay.inMilliseconds));
  }
}

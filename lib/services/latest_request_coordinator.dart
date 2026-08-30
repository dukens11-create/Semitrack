import 'dart:async';

/// Outcome for a request submitted to [LatestRequestCoordinator].
enum LatestRequestCompletion { completed, superseded, cancelled, failed }

typedef LatestRequestExecutor<T> =
    Future<void> Function(T request, int requestId, bool Function() isCurrent);

/// Runs at most one asynchronous request at a time and coalesces queued work.
///
/// If a new request arrives while another is running, the running operation is
/// allowed to finish at the transport layer, but [isCurrent] immediately turns
/// false so its response cannot be applied. Only the newest queued request is
/// executed next. This is useful for route providers whose HTTP calls cannot be
/// cancelled after dispatch.
class LatestRequestCoordinator<T> {
  int _generation = 0;
  bool _draining = false;
  bool _disposed = false;
  _LatestRequest<T>? _active;
  _LatestRequest<T>? _pending;

  bool get inProgress => _draining;
  int get latestRequestId => _generation;

  Future<LatestRequestCompletion> submit(
    T request,
    LatestRequestExecutor<T> executor,
  ) {
    if (_disposed) {
      return Future<LatestRequestCompletion>.value(
        LatestRequestCompletion.cancelled,
      );
    }

    final item = _LatestRequest<T>(
      request: request,
      requestId: ++_generation,
      executor: executor,
    );

    // A not-yet-started request has been replaced by a newer GPS fix. There is
    // no value in sending both to the routing provider.
    final previousPending = _pending;
    if (previousPending != null && !previousPending.completer.isCompleted) {
      previousPending.completer.complete(LatestRequestCompletion.superseded);
    }
    _pending = item;

    if (!_draining) {
      _draining = true;
      unawaited(_drain());
    }
    return item.completer.future;
  }

  /// Invalidates active callbacks and cancels queued work.
  void invalidate() {
    if (_disposed) return;
    _generation++;
    final pending = _pending;
    _pending = null;
    if (pending != null && !pending.completer.isCompleted) {
      pending.completer.complete(LatestRequestCompletion.cancelled);
    }
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _generation++;
    final pending = _pending;
    _pending = null;
    if (pending != null && !pending.completer.isCompleted) {
      pending.completer.complete(LatestRequestCompletion.cancelled);
    }
  }

  Future<void> _drain() async {
    while (!_disposed && _pending != null) {
      final item = _pending!;
      _pending = null;
      _active = item;

      try {
        await item.executor(
          item.request,
          item.requestId,
          () => !_disposed && item.requestId == _generation,
        );
        if (!item.completer.isCompleted) {
          item.completer.complete(
            _disposed
                ? LatestRequestCompletion.cancelled
                : item.requestId == _generation
                ? LatestRequestCompletion.completed
                : LatestRequestCompletion.superseded,
          );
        }
      } catch (error, stackTrace) {
        if (!item.completer.isCompleted) {
          item.completer.completeError(error, stackTrace);
        }
      } finally {
        if (identical(_active, item)) _active = null;
      }
    }

    _active = null;
    _draining = false;
  }
}

class _LatestRequest<T> {
  _LatestRequest({
    required this.request,
    required this.requestId,
    required this.executor,
  });

  final T request;
  final int requestId;
  final LatestRequestExecutor<T> executor;
  final Completer<LatestRequestCompletion> completer =
      Completer<LatestRequestCompletion>();
}

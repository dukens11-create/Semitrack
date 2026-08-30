import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:semitrack_mobile/services/latest_request_coordinator.dart';

void main() {
  test(
    'runs one request at a time and applies only the newest response',
    () async {
      final coordinator = LatestRequestCoordinator<String>();
      final firstGate = Completer<void>();
      final started = <String>[];
      final applied = <String>[];
      var simultaneous = 0;
      var maxSimultaneous = 0;

      Future<void> execute(
        String request,
        int requestId,
        bool Function() isCurrent,
      ) async {
        started.add(request);
        simultaneous++;
        if (simultaneous > maxSimultaneous) maxSimultaneous = simultaneous;
        if (request == 'first') await firstGate.future;
        if (isCurrent()) applied.add(request);
        simultaneous--;
      }

      final first = coordinator.submit('first', execute);
      await Future<void>.delayed(Duration.zero);
      final second = coordinator.submit('second', execute);
      final third = coordinator.submit('third', execute);
      firstGate.complete();

      expect(await first, LatestRequestCompletion.superseded);
      expect(await second, LatestRequestCompletion.superseded);
      expect(await third, LatestRequestCompletion.completed);
      expect(started, ['first', 'third']);
      expect(applied, ['third']);
      expect(maxSimultaneous, 1);
    },
  );

  test('invalidate prevents an active response from being current', () async {
    final coordinator = LatestRequestCoordinator<int>();
    final gate = Completer<void>();
    var applied = false;
    final completion = coordinator.submit(1, (_, __, isCurrent) async {
      await gate.future;
      applied = isCurrent();
    });

    await Future<void>.delayed(Duration.zero);
    coordinator.invalidate();
    gate.complete();

    expect(await completion, LatestRequestCompletion.superseded);
    expect(applied, isFalse);
  });

  test('twelve rapid reroutes never overlap and only latest applies', () async {
    final coordinator = LatestRequestCoordinator<int>();
    final firstGate = Completer<void>();
    final applied = <int>[];
    var simultaneous = 0;
    var maxSimultaneous = 0;

    Future<void> execute(
      int request,
      int requestId,
      bool Function() isCurrent,
    ) async {
      simultaneous++;
      maxSimultaneous = simultaneous > maxSimultaneous
          ? simultaneous
          : maxSimultaneous;
      if (request == 0) await firstGate.future;
      if (isCurrent()) applied.add(request);
      simultaneous--;
    }

    final completions = <Future<LatestRequestCompletion>>[
      coordinator.submit(0, execute),
    ];
    await Future<void>.delayed(Duration.zero);
    for (var request = 1; request < 12; request++) {
      completions.add(coordinator.submit(request, execute));
    }
    firstGate.complete();
    await Future.wait(completions);

    expect(maxSimultaneous, 1);
    expect(applied, [11]);
  });

  test('dispose cancels queued requests', () async {
    final coordinator = LatestRequestCoordinator<int>();
    final gate = Completer<void>();
    final first = coordinator.submit(1, (_, __, ___) => gate.future);
    await Future<void>.delayed(Duration.zero);
    final queued = coordinator.submit(2, (_, __, ___) async {});
    coordinator.dispose();
    gate.complete();

    expect(await first, LatestRequestCompletion.cancelled);
    expect(await queued, LatestRequestCompletion.cancelled);
  });
}

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart' as mbx;

import 'core/app_error_guard.dart';
import 'screens/app_shell.dart';
import 'screens/auth_screen.dart';
import 'services/auth_service.dart';
import 'services/here_sdk_service.dart';
import 'theme/semitrack_theme.dart';

void main() {
  runZonedGuarded(() {
    WidgetsFlutterBinding.ensureInitialized();
    AppErrorGuard.install();
    _startSemiTrack();
  }, AppErrorGuard.reportUncaught);
}

void _startSemiTrack() {
  const mapboxAccessToken = String.fromEnvironment('MAPBOX_ACCESS_TOKEN');
  if (mapboxAccessToken.isNotEmpty) {
    mbx.MapboxOptions.setAccessToken(mapboxAccessToken);
  }
  final auth = AuthService();
  // Render immediately. Native SDK and session restoration must never leave a
  // blank launch screen while a platform service is slow or unavailable.
  runApp(SemiTrackApp(auth: auth));
  unawaited(_initializeOptionalServices(auth));
}

Future<void> _initializeOptionalServices(AuthService auth) async {
  final hereInitialization = () async {
    try {
      await HereSdkService.instance.initialize();
      if (kDebugMode) {
        final status = await HereSdkService.instance.verifyCredentials();
        debugPrint('HERE SDK credential check: ${status.name}.');
        if (status != HereSdkCredentialStatus.verified) {
          debugPrint(
            'HERE SDK-only features remain disabled until credentials are authorized.',
          );
        }
      }
    } catch (error, stack) {
      // SemiTrack route previews use the authenticated backend truck-routing API.
      // Do not crash the entire app when the optional Explore SDK is unavailable;
      // native turn-by-turn remains independently fail-closed.
      debugPrint('HERE SDK startup unavailable (${error.runtimeType}).');
      if (kDebugMode) AppErrorGuard.reportUncaught(error, stack);
    }
  }();
  try {
    await auth.restoreSession();
  } catch (error, stack) {
    // Secure-storage corruption or a platform-channel startup failure must not
    // leave the driver on a blank screen. Start signed out and let login retry.
    AppErrorGuard.reportUncaught(error, stack);
    auth.status = AuthStatus.signedOut;
  }
  // Initialization can continue after the login screen becomes usable.
  await hereInitialization;
}

class SemiTrackApp extends StatefulWidget {
  const SemiTrackApp({super.key, required this.auth});
  final AuthService auth;

  @override
  State<SemiTrackApp> createState() => _SemiTrackAppState();
}

class _SemiTrackAppState extends State<SemiTrackApp> {
  @override
  void dispose() {
    widget.auth.dispose();
    unawaited(HereSdkService.instance.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'SemiTrax',
      theme: SemiTrackTheme.light(),
      darkTheme: SemiTrackTheme.dark(),
      themeMode: ThemeMode.system,
      home: AnimatedBuilder(
        animation: widget.auth,
        builder: (context, _) {
          switch (widget.auth.status) {
            case AuthStatus.loading:
              return const _SemiTraxStartupScreen();
            case AuthStatus.signedOut:
              return AuthScreen(auth: widget.auth);
            case AuthStatus.signedIn:
              return AppShell(auth: widget.auth);
          }
        },
      ),
    );
  }
}

class _SemiTraxStartupScreen extends StatelessWidget {
  const _SemiTraxStartupScreen();

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(
        statusBarColor: Colors.black,
        systemNavigationBarColor: Colors.black,
        systemNavigationBarIconBrightness: Brightness.light,
      ),
      child: Scaffold(
        backgroundColor: Colors.black,
        body: SizedBox.expand(
          child: Image.asset(
            'assets/images/semitrax_splash.png',
            fit: BoxFit.cover,
            filterQuality: FilterQuality.high,
            gaplessPlayback: true,
            semanticLabel: 'SemiTraX — Smarter routes. Safer deliveries.',
            errorBuilder: (context, error, stackTrace) {
              return const _SemiTraxSplashFallback();
            },
          ),
        ),
      ),
    );
  }
}

class _SemiTraxSplashFallback extends StatelessWidget {
  const _SemiTraxSplashFallback();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.black,
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Image.asset(
                  'assets/images/semitrax_brand_lockup.png',
                  width: 360,
                  fit: BoxFit.contain,
                  filterQuality: FilterQuality.high,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

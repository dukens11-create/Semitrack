import 'package:flutter/material.dart';

abstract final class SemiTrackColors {
  static const ink = Color(0xFF101820);
  static const navy = Color(0xFF172433);
  static const orange = Color(0xFFFF6B2C);
  static const orangeDark = Color(0xFFE65318);
  static const green = Color(0xFF14966F);
  static const blue = Color(0xFF2374E1);
  static const canvas = Color(0xFFF3F5F7);
  static const card = Color(0xFFFFFFFF);
  static const darkCanvas = Color(0xFF0C131B);
  static const darkCard = Color(0xFF17212C);
}

abstract final class SemiTrackTheme {
  static ThemeData light() => _build(Brightness.light);

  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    final scheme = ColorScheme.fromSeed(
      seedColor: SemiTrackColors.orange,
      brightness: brightness,
      primary: SemiTrackColors.orange,
      secondary: SemiTrackColors.blue,
      surface: dark ? SemiTrackColors.darkCard : SemiTrackColors.card,
      error: const Color(0xFFD33F49),
    );

    final base = ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: dark
          ? SemiTrackColors.darkCanvas
          : SemiTrackColors.canvas,
    );

    return base.copyWith(
      textTheme: base.textTheme.copyWith(
        headlineLarge: base.textTheme.headlineLarge?.copyWith(
          fontWeight: FontWeight.w900,
          letterSpacing: -1.1,
        ),
        headlineMedium: base.textTheme.headlineMedium?.copyWith(
          fontWeight: FontWeight.w900,
          letterSpacing: -0.7,
        ),
        titleLarge: base.textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w800,
          letterSpacing: -0.25,
        ),
        titleMedium: base.textTheme.titleMedium?.copyWith(
          fontWeight: FontWeight.w700,
        ),
        labelLarge: base.textTheme.labelLarge?.copyWith(
          fontWeight: FontWeight.w800,
        ),
      ),
      appBarTheme: AppBarTheme(
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        backgroundColor: dark ? SemiTrackColors.ink : Colors.white,
        foregroundColor: dark ? Colors.white : SemiTrackColors.ink,
        titleTextStyle: TextStyle(
          color: dark ? Colors.white : SemiTrackColors.ink,
          fontSize: 20,
          fontWeight: FontWeight.w900,
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 72,
        elevation: 10,
        backgroundColor: dark ? SemiTrackColors.ink : Colors.white,
        indicatorColor: SemiTrackColors.orange.withOpacity(0.16),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          return IconThemeData(
            size: 25,
            color: states.contains(WidgetState.selected)
                ? SemiTrackColors.orange
                : dark
                ? Colors.white70
                : const Color(0xFF637080),
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          return TextStyle(
            fontSize: 11,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w900
                : FontWeight.w700,
            color: states.contains(WidgetState.selected)
                ? SemiTrackColors.orange
                : dark
                ? Colors.white70
                : const Color(0xFF637080),
          );
        }),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: dark ? const Color(0xFF202C38) : Colors.white,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(
            color: dark ? Colors.white12 : const Color(0xFFD9DEE4),
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(
            color: dark ? Colors.white12 : const Color(0xFFD9DEE4),
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: SemiTrackColors.orange, width: 2),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 52),
          backgroundColor: SemiTrackColors.orange,
          foregroundColor: Colors.white,
          disabledBackgroundColor: SemiTrackColors.orange.withOpacity(0.35),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 50),
          foregroundColor: dark ? Colors.white : SemiTrackColors.ink,
          side: BorderSide(
            color: dark ? Colors.white24 : const Color(0xFFCED5DD),
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: SemiTrackColors.orange,
        foregroundColor: Colors.white,
      ),
      dividerColor: dark ? Colors.white12 : const Color(0xFFE4E8ED),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: dark ? Colors.white : SemiTrackColors.ink,
        contentTextStyle: TextStyle(
          color: dark ? SemiTrackColors.ink : Colors.white,
          fontWeight: FontWeight.w700,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }
}

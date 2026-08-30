import 'package:flutter/material.dart';

enum ActiveNavigationMenuAction {
  quit,
  reroute,
  poiAhead,
  searchPlaces,
  report,
  placesFilter,
  shareTrip,
  routeOptions,
  audioSettings,
}

class ActiveNavigationMenuScreen extends StatelessWidget {
  const ActiveNavigationMenuScreen({
    super.key,
    required this.instruction,
    required this.maneuverIcon,
    required this.maneuverDistance,
    required this.remainingDistance,
    required this.remainingDuration,
    required this.arrivalTime,
    required this.audioLabel,
    this.towardRoad,
    this.truckName = 'Active truck',
  });

  final String instruction;
  final String? towardRoad;
  final IconData maneuverIcon;
  final String maneuverDistance;
  final String remainingDistance;
  final String remainingDuration;
  final String arrivalTime;
  final String audioLabel;
  final String truckName;

  static const _orange = Color(0xFFFF652B);
  static const _navy = Color(0xFF071521);
  static const _background = Color(0xFF06111B);

  void _return(BuildContext context, ActiveNavigationMenuAction action) {
    Navigator.of(context).pop(action);
  }

  Future<void> _confirmQuit(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Quit navigation?'),
        content: const Text(
          'The active route and live guidance will stop. You can build the route again from the map.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Keep navigating'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: _orange),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Quit navigation'),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      _return(context, ActiveNavigationMenuAction.quit);
    }
  }

  @override
  Widget build(BuildContext context) {
    final toward = towardRoad?.trim();
    return Scaffold(
      backgroundColor: _background,
      body: Column(
        children: [
          _NavigationHeader(
            instruction: instruction,
            towardRoad: toward,
            maneuverIcon: maneuverIcon,
            maneuverDistance: maneuverDistance,
          ),
          _TripSummary(
            remainingDistance: remainingDistance,
            remainingDuration: remainingDuration,
            arrivalTime: arrivalTime,
            onContinue: () => Navigator.pop(context),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 120),
              children: [
                const _SectionTitle(
                  'Quick actions',
                  caption: 'Tools for the route you are driving now',
                ),
                const SizedBox(height: 10),
                _ShortcutCard(
                  children: [
                    _MenuShortcut(
                      icon: Icons.refresh_rounded,
                      color: _orange,
                      label: 'Reroute',
                      description: 'Find a new truck-safe path',
                      onTap: () =>
                          _return(context, ActiveNavigationMenuAction.reroute),
                    ),
                    _MenuShortcut(
                      icon: Icons.add_location_alt_rounded,
                      color: const Color(0xFF2AC58F),
                      label: 'POI Ahead',
                      description: 'Stops along this route',
                      onTap: () =>
                          _return(context, ActiveNavigationMenuAction.poiAhead),
                    ),
                    _MenuShortcut(
                      icon: Icons.search_rounded,
                      color: const Color(0xFF56A8FF),
                      label: 'Search Places',
                      description: 'Add a destination or stop',
                      onTap: () => _return(
                        context,
                        ActiveNavigationMenuAction.searchPlaces,
                      ),
                    ),
                    _MenuShortcut(
                      icon: Icons.report_gmailerrorred_rounded,
                      color: const Color(0xFFFFB64D),
                      label: 'Report',
                      description: 'Share a road or safety issue',
                      onTap: () =>
                          _return(context, ActiveNavigationMenuAction.report),
                    ),
                    _MenuShortcut(
                      icon: Icons.filter_alt_rounded,
                      color: const Color(0xFF9D8CFF),
                      label: 'Places Filter',
                      description: 'Choose visible stop types',
                      onTap: () => _return(
                        context,
                        ActiveNavigationMenuAction.placesFilter,
                      ),
                    ),
                    _MenuShortcut(
                      icon: Icons.share_location_rounded,
                      color: const Color(0xFF33B7D9),
                      label: 'Share Trip',
                      description: 'Send ETA and trip progress',
                      onTap: () => _return(
                        context,
                        ActiveNavigationMenuAction.shareTrip,
                      ),
                    ),
                    _MenuShortcut(
                      icon: Icons.alt_route_rounded,
                      color: _orange,
                      label: 'Route Options',
                      description: 'Review route preferences',
                      onTap: () => _return(
                        context,
                        ActiveNavigationMenuAction.routeOptions,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 22),
                const _SectionTitle('Driving setup'),
                const SizedBox(height: 10),
                _NavigationSettingCard(
                  icon: Icons.local_shipping_rounded,
                  iconColor: _orange,
                  title: truckName,
                  subtitle: 'Truck-safe route profile is active',
                  trailing: Icons.chevron_right_rounded,
                  onTap: () => _return(
                    context,
                    ActiveNavigationMenuAction.audioSettings,
                  ),
                ),
                const SizedBox(height: 22),
                _NavigationSettingCard(
                  icon: audioLabel == 'Muted'
                      ? Icons.volume_off_rounded
                      : Icons.volume_up_rounded,
                  iconColor: const Color(0xFF56A8FF),
                  title: audioLabel,
                  subtitle: 'Voice guidance and safety alerts',
                  trailing: Icons.tune_rounded,
                  onTap: () => _return(
                    context,
                    ActiveNavigationMenuAction.audioSettings,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
          decoration: const BoxDecoration(
            color: _navy,
            border: Border(top: BorderSide(color: Color(0xFF213746))),
          ),
          child: Row(
            children: [
              SizedBox(
                height: 54,
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFFFF9B83),
                    side: const BorderSide(color: Color(0xFF8C473B)),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                  onPressed: () => _confirmQuit(context),
                  icon: const Icon(Icons.stop_circle_outlined),
                  label: const Text(
                    'Quit Nav',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 2,
                child: SizedBox(
                  height: 54,
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: _orange,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                    onPressed: () => Navigator.pop(context),
                    child: const Text(
                      'Continue Navigation',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavigationHeader extends StatelessWidget {
  const _NavigationHeader({
    required this.instruction,
    required this.towardRoad,
    required this.maneuverIcon,
    required this.maneuverDistance,
  });

  final String instruction;
  final String? towardRoad;
  final IconData maneuverIcon;
  final String maneuverDistance;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF07111B), Color(0xFF102A3A)],
        ),
      ),
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.fromLTRB(
          18,
          MediaQuery.paddingOf(context).top + 14,
          18,
          18,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'NEXT MANEUVER',
              style: TextStyle(
                color: Color(0xFFFF8A62),
                fontSize: 11,
                fontWeight: FontWeight.w900,
                letterSpacing: 1.4,
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Container(
                  width: 62,
                  height: 62,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFF652B),
                    borderRadius: BorderRadius.circular(19),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x4DFF652B),
                        blurRadius: 18,
                        offset: Offset(0, 7),
                      ),
                    ],
                  ),
                  child: Icon(maneuverIcon, color: Colors.white, size: 38),
                ),
                const SizedBox(width: 15),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        instruction.isEmpty ? 'Continue on route' : instruction,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 23,
                          fontWeight: FontWeight.w900,
                          height: 1.05,
                        ),
                      ),
                      if (towardRoad != null && towardRoad!.isNotEmpty) ...[
                        const SizedBox(height: 7),
                        Text(
                          'toward $towardRoad',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white70,
                            fontSize: 16,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 11,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.09),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    maneuverDistance,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _TripSummary extends StatelessWidget {
  const _TripSummary({
    required this.remainingDistance,
    required this.remainingDuration,
    required this.arrivalTime,
    required this.onContinue,
  });

  final String remainingDistance;
  final String remainingDuration;
  final String arrivalTime;
  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF0D2030),
      child: InkWell(
        onTap: onContinue,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 16, 14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Flexible(
                          child: Text(
                            remainingDistance,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 27,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 12),
                          child: SizedBox(
                            width: 1,
                            height: 30,
                            child: ColoredBox(color: Color(0xFFB6BAC5)),
                          ),
                        ),
                        Flexible(
                          child: Text(
                            remainingDuration,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 27,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      arrivalTime,
                      style: const TextStyle(
                        color: Color(0xFFA8BAC8),
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                width: 46,
                height: 46,
                decoration: const BoxDecoration(
                  color: Color(0xFF19384B),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.keyboard_arrow_down_rounded,
                  color: Color(0xFFFF8A62),
                  size: 32,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.label, {this.caption});
  final String label;
  final String? caption;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 18,
          fontWeight: FontWeight.w900,
        ),
      ),
      if (caption != null) ...[
        const SizedBox(height: 3),
        Text(
          caption!,
          style: const TextStyle(
            color: Color(0xFF8FA6B7),
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    ],
  );
}

class _ShortcutCard extends StatelessWidget {
  const _ShortcutCard({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFF0D2030),
        border: Border.all(color: const Color(0xFF1D3849)),
        borderRadius: BorderRadius.circular(20),
      ),
      child: GridView.count(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 2,
        childAspectRatio: 2.25,
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        children: children,
      ),
    );
  }
}

class _MenuShortcut extends StatelessWidget {
  const _MenuShortcut({
    required this.icon,
    required this.color,
    required this.label,
    required this.description,
    required this.onTap,
  });

  final IconData icon;
  final Color color;
  final String label;
  final String description;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: InkWell(
        borderRadius: BorderRadius.circular(15),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
          decoration: BoxDecoration(
            color: const Color(0xFF132A3A),
            borderRadius: BorderRadius.circular(15),
          ),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.17),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(icon, color: color, size: 24),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      description,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF8FA6B7),
                        fontSize: 9.5,
                        height: 1.12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavigationSettingCard extends StatelessWidget {
  const _NavigationSettingCard({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.trailing,
    required this.onTap,
  });

  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final IconData trailing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF0D2030),
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(15),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: iconColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Icon(icon, color: iconColor, size: 29),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: Color(0xFF8FA6B7),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(trailing, color: const Color(0xFF6F899A)),
            ],
          ),
        ),
      ),
    );
  }
}

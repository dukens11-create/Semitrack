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

  static const _blue = Color(0xFF0969E8);
  static const _orange = Color(0xFFF45A13);
  static const _background = Color(0xFFF2F4F8);

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
                const _SectionTitle('Navigation shortcuts'),
                const SizedBox(height: 10),
                _ShortcutCard(
                  children: [
                    _MenuShortcut(
                      icon: Icons.refresh_rounded,
                      color: const Color(0xFF747B97),
                      label: 'Reroute',
                      onTap: () =>
                          _return(context, ActiveNavigationMenuAction.reroute),
                    ),
                    _MenuShortcut(
                      icon: Icons.add_location_alt_rounded,
                      color: const Color(0xFF07965B),
                      label: 'POI Ahead',
                      onTap: () =>
                          _return(context, ActiveNavigationMenuAction.poiAhead),
                    ),
                    _MenuShortcut(
                      icon: Icons.search_rounded,
                      color: const Color(0xFF4A5274),
                      label: 'Search Places',
                      onTap: () => _return(
                        context,
                        ActiveNavigationMenuAction.searchPlaces,
                      ),
                    ),
                    _MenuShortcut(
                      icon: Icons.report_gmailerrorred_rounded,
                      color: const Color(0xFF07998E),
                      label: 'Report',
                      onTap: () =>
                          _return(context, ActiveNavigationMenuAction.report),
                    ),
                    _MenuShortcut(
                      icon: Icons.filter_alt_rounded,
                      color: const Color(0xFF4A5274),
                      label: 'Places Filter',
                      onTap: () => _return(
                        context,
                        ActiveNavigationMenuAction.placesFilter,
                      ),
                    ),
                    _MenuShortcut(
                      icon: Icons.share_location_rounded,
                      color: _blue,
                      label: 'Share Trip',
                      onTap: () => _return(
                        context,
                        ActiveNavigationMenuAction.shareTrip,
                      ),
                    ),
                    _MenuShortcut(
                      icon: Icons.alt_route_rounded,
                      color: _orange,
                      label: 'Route Options',
                      onTap: () => _return(
                        context,
                        ActiveNavigationMenuAction.routeOptions,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 22),
                const _SectionTitle('Navigation truck'),
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
                const _SectionTitle('Audio settings'),
                const SizedBox(height: 10),
                _NavigationSettingCard(
                  icon: audioLabel == 'Muted'
                      ? Icons.volume_off_rounded
                      : Icons.volume_up_rounded,
                  iconColor: _blue,
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
            color: Colors.white,
            border: Border(top: BorderSide(color: Color(0xFFE1E5EB))),
          ),
          child: Row(
            children: [
              Expanded(
                child: SizedBox(
                  height: 54,
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: _orange,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(13),
                      ),
                    ),
                    onPressed: () => _confirmQuit(context),
                    child: const Text(
                      'Quit Nav',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
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
                      backgroundColor: _blue,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(13),
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
    return Container(
      width: double.infinity,
      color: const Color(0xFF08090B),
      padding: EdgeInsets.fromLTRB(
        18,
        MediaQuery.paddingOf(context).top + 18,
        18,
        22,
      ),
      child: Row(
        children: [
          Container(
            width: 58,
            height: 58,
            decoration: BoxDecoration(
              color: Colors.white12,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(maneuverIcon, color: Colors.white, size: 36),
          ),
          const SizedBox(width: 14),
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
                    fontSize: 24,
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
          Text(
            maneuverDistance,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
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
      color: Colors.white,
      child: InkWell(
        onTap: onContinue,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 18, 16),
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
                              color: Color(0xFF172049),
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
                              color: Color(0xFF172049),
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
                        color: Color(0xFF747B91),
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
                  color: Color(0xFFE9EBF0),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.keyboard_arrow_down_rounded,
                  color: Color(0xFF747B91),
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
  const _SectionTitle(this.label);
  final String label;

  @override
  Widget build(BuildContext context) => Text(
    label,
    style: const TextStyle(
      color: Color(0xFF747B91),
      fontSize: 15,
      fontWeight: FontWeight.w800,
    ),
  );
}

class _ShortcutCard extends StatelessWidget {
  const _ShortcutCard({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: GridView.count(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 3,
        childAspectRatio: 0.95,
        mainAxisSpacing: 10,
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
    required this.onTap,
  });

  final IconData icon;
  final Color color;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 58,
              height: 58,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              child: Icon(icon, color: Colors.white, size: 30),
            ),
            const SizedBox(height: 9),
            Text(
              label,
              maxLines: 2,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF172049),
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
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
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(18),
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
                        color: Color(0xFF172049),
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: Color(0xFF747B91),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(trailing, color: const Color(0xFFB6BAC5)),
            ],
          ),
        ),
      ),
    );
  }
}

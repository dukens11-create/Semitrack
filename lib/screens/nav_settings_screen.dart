import 'package:flutter/material.dart';
import 'package:semitrack_mobile/models/nav_settings_model.dart';

/// Full-screen, scrollable navigation settings page opened when the user
/// taps the **More** button on [TruckMapScreen].
///
/// All toggle/selection state is stored in a [NavSettingsModel] instance that
/// is passed in from the parent so that the settings survive page transitions.
class NavSettingsScreen extends StatefulWidget {
  const NavSettingsScreen({super.key, required this.settings});

  final NavSettingsModel settings;

  @override
  State<NavSettingsScreen> createState() => _NavSettingsScreenState();
}

class _NavSettingsScreenState extends State<NavSettingsScreen> {
  // Convenience alias so we don't have to type widget.settings everywhere.
  NavSettingsModel get _s => widget.settings;

  // ── Design tokens ────────────────────────────────────────────────────────
  static const Color _bg = Color(0xFF0F1923);
  static const Color _cardBg = Color(0xFF1A2535);
  static const Color _accent = Color(0xFF2196F3);
  static const Color _accentGreen = Color(0xFF4CAF50);
  static const Color _textPrimary = Colors.white;
  static const Color _divider = Color(0xFF253041);

  // ─────────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _cardBg,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new,
              color: _textPrimary, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          'Navigation Settings',
          style: TextStyle(
            color: _textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
        centerTitle: true,
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        children: [
          _buildShortcutSection(),
          const SizedBox(height: 14),
          _buildNavTruckAvatarSection(),
          const SizedBox(height: 14),
          _buildAudioSettingsSection(),
          const SizedBox(height: 14),
          _buildMapTypeSection(),
          const SizedBox(height: 14),
          _buildViewOnMapSection(),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  // ── Section builders ─────────────────────────────────────────────────────

  Widget _buildShortcutSection() {
    return _SectionCard(
      title: 'Shortcut',
      icon: Icons.grid_view_rounded,
      iconColor: _accent,
      children: [
        _ShortcutGrid(
          items: [
            _ShortcutItem(
              icon: Icons.alt_route,
              label: 'Reroute',
              active: _s.shortcutReroute,
              onTap: () =>
                  setState(() => _s.shortcutReroute = !_s.shortcutReroute),
            ),
            _ShortcutItem(
              icon: Icons.local_parking,
              label: 'POI Ahead',
              active: _s.shortcutPoiAhead,
              onTap: () =>
                  setState(() => _s.shortcutPoiAhead = !_s.shortcutPoiAhead),
            ),
            _ShortcutItem(
              icon: Icons.search,
              label: 'Search Places',
              active: _s.shortcutSearchPlaces,
              onTap: () => setState(
                  () => _s.shortcutSearchPlaces = !_s.shortcutSearchPlaces),
            ),
            _ShortcutItem(
              icon: Icons.flag_outlined,
              label: 'Report',
              active: _s.shortcutReport,
              onTap: () =>
                  setState(() => _s.shortcutReport = !_s.shortcutReport),
            ),
            _ShortcutItem(
              icon: Icons.filter_list,
              label: 'Places Filter',
              active: _s.shortcutPlacesFilter,
              onTap: () => setState(
                  () => _s.shortcutPlacesFilter = !_s.shortcutPlacesFilter),
            ),
            _ShortcutItem(
              icon: Icons.share,
              label: 'Share Trip',
              active: _s.shortcutShareTrip,
              onTap: () =>
                  setState(() => _s.shortcutShareTrip = !_s.shortcutShareTrip),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildNavTruckAvatarSection() {
    return _SectionCard(
      title: 'Nav Truck Avatar',
      icon: Icons.local_shipping_outlined,
      iconColor: const Color(0xFFFF9800),
      children: [
        _ToggleRow(
          icon: Icons.directions_bus_filled_outlined,
          label: 'Custom Truck Avatar',
          subtitle: 'Use a personalised truck icon on the map',
          value: _s.customTruckAvatar,
          onChanged: (v) => setState(() => _s.customTruckAvatar = v),
        ),
      ],
    );
  }

  Widget _buildAudioSettingsSection() {
    return _SectionCard(
      title: 'Audio Settings',
      icon: Icons.volume_up_outlined,
      iconColor: const Color(0xFF9C27B0),
      children: [
        // ── Audio mode selector ───────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              _AudioModeChip(
                icon: Icons.volume_off,
                label: 'Muted',
                selected: _s.audioMode == 0,
                onTap: () => setState(() => _s.audioMode = 0),
              ),
              const SizedBox(width: 8),
              _AudioModeChip(
                icon: Icons.notifications_active_outlined,
                label: 'Alert Only',
                selected: _s.audioMode == 1,
                onTap: () => setState(() => _s.audioMode = 1),
              ),
              const SizedBox(width: 8),
              _AudioModeChip(
                icon: Icons.volume_up,
                label: 'Unmuted',
                selected: _s.audioMode == 2,
                onTap: () => setState(() => _s.audioMode = 2),
              ),
            ],
          ),
        ),
        _dividerLine(),
        _TappableRow(
          icon: Icons.record_voice_over_outlined,
          label: 'Voice Package',
          value: _s.voicePackage,
          onTap: () {
            // TODO: open voice-package picker
          },
        ),
        _dividerLine(),
        _TappableRow(
          icon: Icons.tune,
          label: 'More Audio Settings',
          onTap: () {
            // TODO: open full audio settings page
          },
        ),
      ],
    );
  }

  Widget _buildMapTypeSection() {
    return _SectionCard(
      title: 'Map Type',
      icon: Icons.map_outlined,
      iconColor: _accentGreen,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              _MapTypeCard(
                icon: Icons.map,
                label: 'Map',
                selected: _s.mapType == 0,
                onTap: () => setState(() => _s.mapType = 0),
              ),
              const SizedBox(width: 12),
              _MapTypeCard(
                icon: Icons.satellite_alt,
                label: 'Satellite',
                selected: _s.mapType == 1,
                onTap: () => setState(() => _s.mapType = 1),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildViewOnMapSection() {
    return _SectionCard(
      title: 'View On Map',
      icon: Icons.remove_red_eye_outlined,
      iconColor: const Color(0xFF00BCD4),
      children: [
        _ToggleRow(
          icon: Icons.account_tree_outlined,
          label: 'Junction View',
          value: _s.viewJunctionView,
          onChanged: (v) => setState(() => _s.viewJunctionView = v),
        ),
        _dividerLine(),
        _ToggleRow(
          icon: Icons.linear_scale,
          label: 'Lane Assist',
          value: _s.viewLaneAssist,
          onChanged: (v) => setState(() => _s.viewLaneAssist = v),
        ),
        _dividerLine(),
        _ToggleRow(
          icon: Icons.local_shipping,
          label: 'Truck Restrictions',
          value: _s.viewTruckRestrictions,
          onChanged: (v) => setState(() => _s.viewTruckRestrictions = v),
        ),
        _dividerLine(),
        _ToggleRow(
          icon: Icons.signpost_outlined,
          label: 'Exit',
          value: _s.viewExit,
          onChanged: (v) => setState(() => _s.viewExit = v),
        ),
        _dividerLine(),
        _ToggleRow(
          icon: Icons.traffic,
          label: 'Traffic Congestion',
          value: _s.viewTrafficCongestion,
          onChanged: (v) => setState(() => _s.viewTrafficCongestion = v),
        ),
        _dividerLine(),
        _ToggleRow(
          icon: Icons.warning_amber_outlined,
          label: 'Traffic Incidents',
          value: _s.viewTrafficIncidents,
          onChanged: (v) => setState(() => _s.viewTrafficIncidents = v),
        ),
        _dividerLine(),
        _ToggleRow(
          icon: Icons.thunderstorm_outlined,
          label: 'Weather Alert',
          value: _s.viewWeatherAlert,
          onChanged: (v) => setState(() => _s.viewWeatherAlert = v),
        ),
        _dividerLine(),
        _ToggleRow(
          icon: Icons.scale_outlined,
          label: 'Weigh Station',
          value: _s.viewWeighStation,
          onChanged: (v) => setState(() => _s.viewWeighStation = v),
        ),
        _dividerLine(),
        _ToggleRow(
          icon: Icons.speed,
          label: 'Speed Limit',
          value: _s.viewSpeedLimit,
          onChanged: (v) => setState(() => _s.viewSpeedLimit = v),
        ),
        _dividerLine(),
        _ToggleRow(
          icon: Icons.videocam_outlined,
          label: '511 Camera',
          value: _s.view511Camera,
          onChanged: (v) => setState(() => _s.view511Camera = v),
        ),
        _dividerLine(),
        _ToggleRow(
          icon: Icons.turn_right_outlined,
          label: 'Road Sign',
          value: _s.viewRoadSign,
          onChanged: (v) => setState(() => _s.viewRoadSign = v),
        ),
        _dividerLine(),
        _ToggleRow(
          icon: Icons.toll_outlined,
          label: 'Tollbooth',
          value: _s.viewTollbooth,
          onChanged: (v) => setState(() => _s.viewTollbooth = v),
        ),
      ],
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  Widget _dividerLine() => const Divider(
        color: _divider,
        height: 1,
        thickness: 1,
      );
}

// ── Private helper widgets ────────────────────────────────────────────────────

/// Rounded card wrapping a labelled section.
class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.title,
    required this.icon,
    required this.iconColor,
    required this.children,
  });

  final String title;
  final IconData icon;
  final Color iconColor;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF1A2535),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Section header ───────────────────────────────────────────────
          Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: iconColor.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, color: iconColor, size: 18),
                ),
                const SizedBox(width: 10),
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.3,
                  ),
                ),
              ],
            ),
          ),
          const Divider(color: Color(0xFF253041), height: 1, thickness: 1),
          // ── Section content ──────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: children,
            ),
          ),
        ],
      ),
    );
  }
}

/// Tappable shortcut grid (2-column wrap).
class _ShortcutGrid extends StatelessWidget {
  const _ShortcutGrid({required this.items});
  final List<_ShortcutItem> items;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: items,
    );
  }
}

/// Single shortcut tile inside [_ShortcutGrid].
class _ShortcutItem extends StatelessWidget {
  const _ShortcutItem({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    const Color activeColor = Color(0xFF2196F3);
    const Color inactiveColor = Color(0xFF253041);
    final Color bg = active ? activeColor.withOpacity(0.18) : inactiveColor;
    final Color iconColor = active ? activeColor : const Color(0xFF8A9BB0);
    final Color textColor = active ? Colors.white : const Color(0xFF8A9BB0);
    final Color border =
        active ? activeColor.withOpacity(0.5) : Colors.transparent;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 88,
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: border, width: 1.5),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: iconColor, size: 22),
            const SizedBox(height: 6),
            Text(
              label,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: textColor,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Row with icon, label, optional subtitle, and a toggle switch.
class _ToggleRow extends StatelessWidget {
  const _ToggleRow({
    required this.icon,
    required this.label,
    this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final IconData icon;
  final String label;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Icon(icon, color: const Color(0xFF8A9BB0), size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: const TextStyle(
                      color: Color(0xFF8A9BB0),
                      fontSize: 12,
                    ),
                  ),
                ],
              ],
            ),
          ),
          Switch.adaptive(
            value: value,
            onChanged: onChanged,
            activeColor: const Color(0xFF2196F3),
            activeTrackColor: const Color(0xFF2196F3).withOpacity(0.35),
          ),
        ],
      ),
    );
  }
}

/// Row that navigates to another page or shows a value, with a chevron.
class _TappableRow extends StatelessWidget {
  const _TappableRow({
    required this.icon,
    required this.label,
    this.value,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            Icon(icon, color: const Color(0xFF8A9BB0), size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            if (value != null)
              Text(
                value!,
                style: const TextStyle(
                  color: Color(0xFF8A9BB0),
                  fontSize: 13,
                ),
              ),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right,
                color: Color(0xFF8A9BB0), size: 18),
          ],
        ),
      ),
    );
  }
}

/// Compact chip for the audio-mode selector.
class _AudioModeChip extends StatelessWidget {
  const _AudioModeChip({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    const Color accent = Color(0xFF2196F3);
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: selected ? accent.withOpacity(0.18) : const Color(0xFF253041),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: selected ? accent.withOpacity(0.6) : Colors.transparent,
              width: 1.5,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon,
                  color: selected ? accent : const Color(0xFF8A9BB0), size: 20),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  color: selected ? Colors.white : const Color(0xFF8A9BB0),
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Large map-type selection card.
class _MapTypeCard extends StatelessWidget {
  const _MapTypeCard({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    const Color accent = Color(0xFF4CAF50);
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 18),
          decoration: BoxDecoration(
            color: selected ? accent.withOpacity(0.18) : const Color(0xFF253041),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected ? accent : Colors.transparent,
              width: 2,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon,
                  color: selected ? accent : const Color(0xFF8A9BB0), size: 28),
              const SizedBox(height: 8),
              Text(
                label,
                style: TextStyle(
                  color: selected ? Colors.white : const Color(0xFF8A9BB0),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (selected) ...[
                const SizedBox(height: 4),
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: accent,
                    shape: BoxShape.circle,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

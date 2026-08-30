import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../models/subscription_plan.dart';
import '../services/subscription_plan_service.dart';

class SubscriptionPlansScreen extends StatefulWidget {
  const SubscriptionPlansScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<SubscriptionPlansScreen> createState() =>
      _SubscriptionPlansScreenState();
}

class _SubscriptionPlansScreenState extends State<SubscriptionPlansScreen> {
  late final SubscriptionPlanService service;

  @override
  void initState() {
    super.initState();
    service = SubscriptionPlanService(widget.api)..load();
  }

  @override
  void dispose() {
    service.dispose();
    super.dispose();
  }

  void _selectPlan(SubscriptionPlan plan) {
    if (!plan.isActive) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${plan.displayName} is coming later.')),
      );
      return;
    }
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF102131),
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                plan.displayName,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '${plan.priceLabel} ${plan.cadenceLabel}',
                style: const TextStyle(
                  color: Color(0xFFFF6B2C),
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Secure checkout is not enabled in this development build. '
                'No payment or subscription change has been made.',
                style: TextStyle(color: Color(0xFFB6C4CF), height: 1.45),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Got it'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF06131E),
      appBar: AppBar(
        backgroundColor: const Color(0xFF071521),
        foregroundColor: Colors.white,
        title: const _SemiTraXTitle(),
      ),
      body: AnimatedBuilder(
        animation: service,
        builder: (context, _) => RefreshIndicator(
          onRefresh: service.load,
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              const SliverToBoxAdapter(child: _PremiumHero()),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
                  child: _BenefitStrip(),
                ),
              ),
              if (service.loading && service.plans.isEmpty)
                const SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (service.error != null && service.plans.isEmpty)
                SliverToBoxAdapter(
                  child: _LoadError(
                    message: service.error!,
                    retry: service.load,
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                  sliver: SliverToBoxAdapter(
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        final cardWidth = constraints.maxWidth >= 840
                            ? (constraints.maxWidth - 24) / 3
                            : constraints.maxWidth;
                        return Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: service.plans
                              .map(
                                (plan) => SizedBox(
                                  width: cardWidth,
                                  child: _PlanCard(
                                    plan: plan,
                                    onPressed: () => _selectPlan(plan),
                                  ),
                                ),
                              )
                              .toList(),
                        );
                      },
                    ),
                  ),
                ),
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(16, 24, 16, 32),
                  child: _PremiumFeatures(),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SemiTraXTitle extends StatelessWidget {
  const _SemiTraXTitle();

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Image.asset(
        'assets/images/semitrax_logo.png',
        width: 66,
        height: 35,
        fit: BoxFit.contain,
        filterQuality: FilterQuality.high,
      ),
      const SizedBox(width: 8),
      const Text('Premium', style: TextStyle(fontWeight: FontWeight.w800)),
    ],
  );
}

class _PremiumHero extends StatelessWidget {
  const _PremiumHero();

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 270,
    child: Stack(
      fit: StackFit.expand,
      children: [
        Image.asset(
          'assets/images/semitrax_auth_background_v2.png',
          fit: BoxFit.cover,
          alignment: Alignment.center,
          errorBuilder: (_, _, _) => const ColoredBox(color: Color(0xFF0C2030)),
        ),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [Color(0xF206131E), Color(0xA806131E), Color(0x4406131E)],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(28),
          child: Align(
            alignment: Alignment.centerLeft,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: const Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Unlock the full power\nof SemiTraX',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 32,
                      height: 1.12,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  SizedBox(height: 14),
                  Text(
                    'Professional commercial-truck tools, live road insight, and planning built around your vehicle.',
                    style: TextStyle(
                      color: Color(0xFFD0DAE1),
                      fontSize: 16,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

class _BenefitStrip extends StatelessWidget {
  @override
  Widget build(BuildContext context) => const Wrap(
    alignment: WrapAlignment.spaceAround,
    spacing: 10,
    runSpacing: 12,
    children: [
      _Benefit(
        icon: Icons.verified_user_outlined,
        label: 'Truck-first\nrouting',
      ),
      _Benefit(
        icon: Icons.local_gas_station_outlined,
        label: 'Commercial\nstops',
      ),
      _Benefit(icon: Icons.local_parking_outlined, label: 'Truck\nparking'),
      _Benefit(icon: Icons.schedule_outlined, label: 'DOT/HOS\nalerts'),
    ],
  );
}

class _Benefit extends StatelessWidget {
  const _Benefit({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 112,
    child: Column(
      children: [
        Icon(icon, color: const Color(0xFF67A4FF), size: 30),
        const SizedBox(height: 8),
        Text(
          label,
          textAlign: TextAlign.center,
          style: const TextStyle(color: Colors.white, height: 1.25),
        ),
      ],
    ),
  );
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({required this.plan, required this.onPressed});
  final SubscriptionPlan plan;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final accent = plan.isFeatured
        ? const Color(0xFFFF6B2C)
        : plan.billingInterval == 'YEAR'
        ? const Color(0xFF45C56A)
        : const Color(0xFF5D9DFF);
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xD90C2030),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: plan.isFeatured ? accent : const Color(0xFF385064),
        ),
        boxShadow: const [
          BoxShadow(
            color: Colors.black26,
            blurRadius: 24,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (plan.badge != null)
            Align(
              alignment: Alignment.center,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: .2),
                  borderRadius: BorderRadius.circular(30),
                ),
                child: Text(
                  plan.badge!,
                  style: TextStyle(
                    color: accent,
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ),
          const SizedBox(height: 12),
          Text(
            plan.displayName,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: accent,
              fontSize: 21,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            plan.purpose,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFFB7C6D0)),
          ),
          const SizedBox(height: 18),
          Text(
            plan.priceLabel,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 38,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            plan.cadenceLabel,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFFB7C6D0)),
          ),
          const SizedBox(height: 18),
          Text(
            plan.description ?? 'SemiTraX Premium access.',
            style: const TextStyle(color: Color(0xFFD3DCE2), height: 1.45),
          ),
          const SizedBox(height: 20),
          OutlinedButton(
            onPressed: onPressed,
            style: OutlinedButton.styleFrom(
              foregroundColor: accent,
              side: BorderSide(color: accent),
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            child: Text(plan.isActive ? plan.actionLabel : 'Coming later'),
          ),
        ],
      ),
    );
  }
}

class _PremiumFeatures extends StatelessWidget {
  const _PremiumFeatures();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: const Color(0xFF0A1B29),
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: const Color(0xFF243D50)),
    ),
    child: const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Everything in Premium',
          style: TextStyle(
            color: Colors.white,
            fontSize: 21,
            fontWeight: FontWeight.w900,
          ),
        ),
        SizedBox(height: 16),
        _Feature(
          icon: Icons.alt_route,
          title: 'Truck-specific route planning',
          description:
              'Height, weight, axle, trailer, and hazmat inputs stay attached to route requests.',
        ),
        _Feature(
          icon: Icons.traffic,
          title: 'Live road and DOT information',
          description:
              'Commercial restrictions, incidents, work zones, and enforcement data when available.',
        ),
        _Feature(
          icon: Icons.local_shipping_outlined,
          title: 'Commercial POIs',
          description:
              'Truck stops, weigh stations, rest areas, parking, and diesel-focused places.',
        ),
        _Feature(
          icon: Icons.folder_copy_outlined,
          title: 'Trip and document tools',
          description:
              'Keep truck profiles, trips, saved places, and important documents organized.',
        ),
        SizedBox(height: 10),
        Divider(color: Color(0xFF294154)),
        SizedBox(height: 10),
        Row(
          children: [
            Icon(Icons.lock_outline, color: Color(0xFF45C56A)),
            SizedBox(width: 9),
            Expanded(
              child: Text(
                'Catalog prices come directly from the secured SemiTraX backend.',
                style: TextStyle(color: Color(0xFFAFBFCA)),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class _Feature extends StatelessWidget {
  const _Feature({
    required this.icon,
    required this.title,
    required this.description,
  });
  final IconData icon;
  final String title;
  final String description;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 15),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: const Color(0xFF132B3D),
            borderRadius: BorderRadius.circular(11),
          ),
          child: Icon(icon, color: const Color(0xFF68A5FF)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                description,
                style: const TextStyle(color: Color(0xFF9DB0BD), height: 1.4),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _LoadError extends StatelessWidget {
  const _LoadError({required this.message, required this.retry});
  final String message;
  final Future<void> Function() retry;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(24),
    child: Card(
      color: const Color(0xFF2D1920),
      child: ListTile(
        leading: const Icon(Icons.cloud_off, color: Color(0xFFFF8179)),
        title: const Text('Current prices are unavailable'),
        subtitle: Text(message),
        trailing: IconButton(onPressed: retry, icon: const Icon(Icons.refresh)),
      ),
    ),
  );
}

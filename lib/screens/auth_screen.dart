import 'package:flutter/material.dart';

import '../services/auth_service.dart';
import '../theme/semitrack_theme.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _register = false;
  bool _busy = false;
  bool _obscure = true;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final ok = _register
        ? await widget.auth.register(_name.text, _email.text, _password.text)
        : await widget.auth.login(_email.text, _password.text);
    if (mounted) setState(() => _busy = false);
    if (!ok && mounted && widget.auth.errorMessage != null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(widget.auth.errorMessage!)));
    }
  }

  Future<void> _resetPassword() async {
    if (_email.text.trim().isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Enter your email first.')));
      return;
    }
    try {
      await widget.auth.requestPasswordReset(_email.text);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'If the account exists, recovery instructions will be sent.',
            ),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Password recovery is temporarily unavailable.'),
          ),
        );
      }
    }
  }

  void _selectMode(bool register) {
    if (_busy || _register == register) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _register = register;
      _formKey.currentState?.reset();
    });
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return Theme(
      data: SemiTrackTheme.dark(),
      child: Scaffold(
        resizeToAvoidBottomInset: true,
        backgroundColor: SemiTrackColors.darkCanvas,
        body: Stack(
          fit: StackFit.expand,
          children: [
            Transform.translate(
              // Lift the artwork so the complete tractor and trailer remain
              // visible above the authentication card on common phone sizes.
              offset: const Offset(0, -175),
              child: Image.asset(
                'assets/images/semitrax_auth_background_v2.png',
                fit: BoxFit.fitWidth,
                alignment: Alignment.topCenter,
                errorBuilder: (_, __, ___) =>
                    const ColoredBox(color: SemiTrackColors.darkCanvas),
              ),
            ),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  stops: [0, 0.28, 0.66, 1],
                  colors: [
                    Color(0xD90A121B),
                    Color(0x59111C27),
                    Color(0xB80A121B),
                    Color(0xFF071019),
                  ],
                ),
              ),
            ),
            SafeArea(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  return SingleChildScrollView(
                    keyboardDismissBehavior:
                        ScrollViewKeyboardDismissBehavior.onDrag,
                    padding: EdgeInsets.fromLTRB(
                      20,
                      22,
                      20,
                      bottomInset > 0 ? 20 : 28,
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          maxWidth: 500,
                          minHeight:
                              (constraints.maxHeight -
                                      (bottomInset > 0 ? 42 : 50))
                                  .clamp(0, double.infinity),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Align(
                              alignment: Alignment.centerLeft,
                              child: Semantics(
                                image: true,
                                label: 'Semi-TraX — Smarter routes. Safer deliveries.',
                                child: FractionallySizedBox(
                                  widthFactor: 0.72,
                                  alignment: Alignment.centerLeft,
                                  child: ConstrainedBox(
                                    constraints: const BoxConstraints(
                                      maxWidth: 300,
                                    ),
                                    child: Container(
                                      padding: const EdgeInsets.all(5),
                                      decoration: BoxDecoration(
                                        color: const Color(0xE6000000),
                                        borderRadius: BorderRadius.circular(14),
                                        border: Border.all(
                                          color: const Color(0x26FFFFFF),
                                        ),
                                        boxShadow: const [
                                          BoxShadow(
                                            color: Color(0x44000000),
                                            blurRadius: 12,
                                            offset: Offset(0, 4),
                                          ),
                                        ],
                                      ),
                                      child: AspectRatio(
                                        aspectRatio: 1723 / 541,
                                        child: ClipRRect(
                                          borderRadius: BorderRadius.circular(
                                            9,
                                          ),
                                          child: Image.asset(
                                            'assets/images/semitrax_login_lockup.png',
                                            fit: BoxFit.contain,
                                            filterQuality: FilterQuality.high,
                                            excludeFromSemantics: true,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 20),
                            AnimatedSwitcher(
                              duration: const Duration(milliseconds: 220),
                              child: Column(
                                key: ValueKey(_register),
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _register
                                        ? 'Create your driver account'
                                        : 'Truck-safe navigation starts here',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 27,
                                      height: 1.08,
                                      fontWeight: FontWeight.w900,
                                      letterSpacing: -0.8,
                                    ),
                                  ),
                                  const SizedBox(height: 12),
                                  Text(
                                    _register
                                        ? 'Build a secure profile for your commercial vehicle.'
                                        : 'Routes built around your vehicle—not a passenger car.',
                                    style: const TextStyle(
                                      color: Color(0xFFC1CAD3),
                                      fontSize: 16,
                                      height: 1.42,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                  const SizedBox(height: 15),
                                  Container(
                                    width: 54,
                                    height: 3,
                                    decoration: BoxDecoration(
                                      color: SemiTrackColors.orange,
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            SizedBox(
                              height: bottomInset > 0
                                  ? 18
                                  : constraints.maxHeight > 760
                                  ? 122
                                  : 36,
                            ),
                            const SizedBox(height: 28),
                            Container(
                              padding: const EdgeInsets.all(20),
                              decoration: BoxDecoration(
                                color: const Color(0xEE101A24),
                                borderRadius: BorderRadius.circular(27),
                                border: Border.all(color: Colors.white12),
                                boxShadow: const [
                                  BoxShadow(
                                    color: Color(0xA6000000),
                                    blurRadius: 34,
                                    offset: Offset(0, 18),
                                  ),
                                ],
                              ),
                              child: AutofillGroup(
                                child: Form(
                                  key: _formKey,
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: _ModeButton(
                                              label: 'Sign in',
                                              selected: !_register,
                                              onTap: _busy
                                                  ? null
                                                  : () => _selectMode(false),
                                            ),
                                          ),
                                          const SizedBox(width: 8),
                                          Expanded(
                                            child: _ModeButton(
                                              label: 'Create account',
                                              selected: _register,
                                              onTap: _busy
                                                  ? null
                                                  : () => _selectMode(true),
                                            ),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 20),
                                      if (_register) ...[
                                        TextFormField(
                                          controller: _name,
                                          autofillHints: const [
                                            AutofillHints.name,
                                          ],
                                          textCapitalization:
                                              TextCapitalization.words,
                                          textInputAction: TextInputAction.next,
                                          decoration: const InputDecoration(
                                            labelText: 'Full name',
                                            prefixIcon: Icon(
                                              Icons.person_outline_rounded,
                                            ),
                                          ),
                                          validator: (value) =>
                                              (value?.trim().length ?? 0) < 2
                                              ? 'Enter your full name'
                                              : null,
                                        ),
                                        const SizedBox(height: 13),
                                      ],
                                      TextFormField(
                                        controller: _email,
                                        autofillHints: const [
                                          AutofillHints.email,
                                        ],
                                        keyboardType:
                                            TextInputType.emailAddress,
                                        textInputAction: TextInputAction.next,
                                        decoration: const InputDecoration(
                                          labelText: 'Email',
                                          prefixIcon: Icon(
                                            Icons.mail_outline_rounded,
                                          ),
                                        ),
                                        validator: (value) =>
                                            !(value?.contains('@') ?? false)
                                            ? 'Enter a valid email'
                                            : null,
                                      ),
                                      const SizedBox(height: 13),
                                      TextFormField(
                                        controller: _password,
                                        autofillHints: _register
                                            ? const [AutofillHints.newPassword]
                                            : const [AutofillHints.password],
                                        obscureText: _obscure,
                                        onFieldSubmitted: (_) {
                                          if (!_busy) _submit();
                                        },
                                        decoration: InputDecoration(
                                          labelText: 'Password',
                                          prefixIcon: const Icon(
                                            Icons.lock_outline_rounded,
                                          ),
                                          suffixIcon: IconButton(
                                            tooltip: _obscure
                                                ? 'Show password'
                                                : 'Hide password',
                                            onPressed: () => setState(
                                              () => _obscure = !_obscure,
                                            ),
                                            icon: Icon(
                                              _obscure
                                                  ? Icons.visibility_outlined
                                                  : Icons
                                                        .visibility_off_outlined,
                                            ),
                                          ),
                                        ),
                                        validator: (value) {
                                          if ((value?.length ?? 0) <
                                              (_register ? 10 : 1)) {
                                            return _register
                                                ? 'Use at least 10 characters'
                                                : 'Enter your password';
                                          }
                                          return null;
                                        },
                                      ),
                                      if (!_register)
                                        Align(
                                          alignment: Alignment.centerRight,
                                          child: TextButton(
                                            onPressed: _busy
                                                ? null
                                                : _resetPassword,
                                            child: const Text(
                                              'Forgot password?',
                                            ),
                                          ),
                                        )
                                      else
                                        const SizedBox(height: 18),
                                      FilledButton(
                                        onPressed: _busy ? null : _submit,
                                        child: _busy
                                            ? const SizedBox.square(
                                                dimension: 21,
                                                child:
                                                    CircularProgressIndicator(
                                                      strokeWidth: 2.2,
                                                      color: Colors.white,
                                                    ),
                                              )
                                            : Text(
                                                _register
                                                    ? 'Create account'
                                                    : 'Sign in',
                                              ),
                                      ),
                                      const SizedBox(height: 16),
                                      const Row(
                                        mainAxisAlignment:
                                            MainAxisAlignment.center,
                                        children: [
                                          Icon(
                                            Icons.verified_user_outlined,
                                            size: 16,
                                            color: Color(0xFF9FAAB5),
                                          ),
                                          SizedBox(width: 7),
                                          Flexible(
                                            child: Text(
                                              'Secure access for commercial drivers',
                                              textAlign: TextAlign.center,
                                              style: TextStyle(
                                                color: Color(0xFF9FAAB5),
                                                fontSize: 12,
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ModeButton extends StatelessWidget {
  const _ModeButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 8),
          decoration: BoxDecoration(
            color: selected
                ? SemiTrackColors.orange.withValues(alpha: 0.1)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? SemiTrackColors.orange : Colors.white12,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: selected ? SemiTrackColors.orange : Colors.white,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ),
    );
  }
}

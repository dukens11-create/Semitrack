import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';

class VoiceDestinationException implements Exception {
  const VoiceDestinationException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Captures a short destination phrase with the device speech recognizer.
///
/// The recognizer is initialized lazily so microphone permission is requested
/// only after the driver taps the microphone. No audio is stored by SemiTrax.
class VoiceDestinationService {
  VoiceDestinationService({SpeechToText? speech})
    : _speech = speech ?? SpeechToText();

  final SpeechToText _speech;
  bool _initialized = false;
  Completer<String?>? _activeCompleter;
  String _latestTranscript = '';

  bool get isListening => _speech.isListening;

  Future<String?> listen({
    required ValueChanged<String> onTranscript,
    String? localeId,
  }) async {
    await cancel();
    _initialized =
        _initialized ||
        await _speech.initialize(
          finalTimeout: const Duration(seconds: 2),
          debugLogging: false,
        );
    if (!_initialized) {
      throw const VoiceDestinationException(
        'Microphone or speech-recognition permission is unavailable. Enable it in phone settings and try again.',
      );
    }

    final completer = Completer<String?>();
    _activeCompleter = completer;
    _latestTranscript = '';

    _speech.statusListener = (status) {
      if (status == SpeechToText.doneStatus && !completer.isCompleted) {
        final text = _latestTranscript.trim();
        completer.complete(text.isEmpty ? null : text);
      }
    };
    _speech.errorListener = (SpeechRecognitionError error) {
      if (completer.isCompleted) return;
      if (error.errorMsg == 'error_no_match' ||
          error.errorMsg == 'error_speech_timeout') {
        completer.complete(null);
        return;
      }
      completer.completeError(VoiceDestinationException(_friendlyError(error)));
    };

    try {
      await _speech.listen(
        onResult: (SpeechRecognitionResult result) {
          final text = result.recognizedWords.trim();
          if (text.isNotEmpty) {
            _latestTranscript = text;
            onTranscript(text);
          }
          if (result.finalResult && !completer.isCompleted) {
            completer.complete(text.isEmpty ? null : text);
          }
        },
        listenOptions: SpeechListenOptions(
          localeId: localeId,
          listenMode: ListenMode.search,
          partialResults: true,
          cancelOnError: true,
          autoPunctuation: false,
          listenFor: const Duration(seconds: 20),
          pauseFor: const Duration(seconds: 3),
        ),
      );
      return await completer.future.timeout(
        const Duration(seconds: 24),
        onTimeout: () {
          final text = _latestTranscript.trim();
          return text.isEmpty ? null : text;
        },
      );
    } finally {
      if (_speech.isListening) {
        await _speech.stop();
      }
      if (identical(_activeCompleter, completer)) {
        _activeCompleter = null;
      }
      _speech.statusListener = null;
      _speech.errorListener = null;
    }
  }

  Future<void> cancel() async {
    final completer = _activeCompleter;
    if (completer != null && !completer.isCompleted) {
      completer.complete(null);
    }
    _activeCompleter = null;
    if (_initialized && _speech.isListening) {
      await _speech.cancel();
    }
  }

  Future<void> dispose() => cancel();

  static String _friendlyError(SpeechRecognitionError error) {
    switch (error.errorMsg) {
      case 'error_permission':
      case 'error_permission_denied':
        return 'Microphone permission was denied. Enable microphone access for SemiTrax in phone settings.';
      case 'error_network':
      case 'error_network_timeout':
        return 'Voice recognition needs a working connection right now. Check the connection and try again.';
      case 'error_busy':
        return 'The phone speech recognizer is busy. Wait a moment and try again.';
      case 'error_audio':
        return 'The microphone could not start. Check Bluetooth or microphone settings and try again.';
      default:
        return error.permanent
            ? 'Speech recognition is unavailable on this phone. Check microphone and speech-service settings.'
            : 'I could not understand that destination. Please try again.';
    }
  }
}

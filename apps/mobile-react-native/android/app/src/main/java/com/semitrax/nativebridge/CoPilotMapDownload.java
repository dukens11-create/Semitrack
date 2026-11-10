package com.semitrax.nativebridge;

import java.util.function.Supplier;

/** One resume attempt only after the SDK explicitly reports a paused download. */
final class CoPilotMapDownload {
  static <T> T request(Supplier<T> download, Supplier<T> resume, T paused) {
    T response = download.get();
    return paused.equals(response) ? resume.get() : response;
  }
}

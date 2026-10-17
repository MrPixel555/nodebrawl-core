package org.nodebrawl.client;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

/** Copies a packaged text file before GameApp loads. No Activity or UI. */
public final class ServerApplication extends android.support.multidex.MultiDexApplication {
    @Override public void onCreate() {
        super.onCreate();
        File pending = new File(getFilesDir(), "configs.so.new");
        File destination = new File(getFilesDir(), "configs.so");
        try {
            InputStream input = getAssets().open("configs.so");
            try {
                FileOutputStream output = new FileOutputStream(pending);
                try {
                    byte[] buffer = new byte[272];
                    int count = 0;
                    while (count < buffer.length) {
                        int next = input.read(buffer, count, buffer.length - count);
                        if (next == -1) break;
                        if (next == 0) throw new java.io.IOException("Cannot read configs.so");
                        count += next;
                    }
                    if (count <= 0 || count >= buffer.length)
                        throw new java.io.IOException("Invalid configs.so size");
                    output.write(buffer, 0, count);
                    output.getFD().sync();
                } finally { output.close(); }
            } finally { input.close(); }
            if (!pending.renameTo(destination)) throw new java.io.IOException("Cannot copy configs.so");
        } catch (Exception error) {
            // Do not use an obsolete address left by an earlier APK.
            pending.delete();
            destination.delete();
            throw new IllegalStateException("Could not initialize assets/configs.so", error);
        }
    }
}

package org.nodebrawl.client;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Process;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.net.IDN;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.util.List;

/** Separate-process launcher: no instrumentation runtime, native loading or
 * account/preference modification. Only the selected endpoint is stored. */
public final class ServerActivity extends Activity {
    private EditText hostInput;
    private EditText portInput;
    private TextView status;
    private Button connect;
    private SharedPreferences preferences;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setTitle("Private server");
        preferences = getSharedPreferences("private_server", Context.MODE_PRIVATE);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        int padding = (int)(24 * getResources().getDisplayMetrics().density);
        body.setPadding(padding, padding, padding, padding);
        body.setBackgroundColor(Color.WHITE);
        TextView title = label("Connect to your server");
        title.setTextSize(24);
        body.addView(title);
        body.addView(label("Server IP or hostname"));
        hostInput = new EditText(this);
        hostInput.setSingleLine(true);
        hostInput.setTextColor(Color.BLACK);
        hostInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        hostInput.setText(preferences.getString("host", "223.223.223.1"));
        body.addView(hostInput);
        body.addView(label("Port"));
        portInput = new EditText(this);
        portInput.setSingleLine(true);
        portInput.setTextColor(Color.BLACK);
        portInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        portInput.setText(Integer.toString(preferences.getInt("port", 9339)));
        body.addView(portInput);
        body.addView(label("Connecting restarts the game with this address."));
        connect = new Button(this);
        connect.setText("Save and connect");
        body.addView(connect);
        status = label("");
        body.addView(status);
        setContentView(body);
        connect.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { connect(); }
        });
    }

    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.BLACK);
        view.setPadding(0, 12, 0, 8);
        return view;
    }

    private void connect() {
        final String host;
        final int port;
        try {
            String input = hostInput.getText().toString().trim();
            if (input.length() == 0 || input.length() > 253 || input.indexOf(':') >= 0 || input.indexOf('/') >= 0)
                throw new IllegalArgumentException();
            host = IDN.toASCII(input, IDN.USE_STD3_ASCII_RULES);
            if (!host.matches("[A-Za-z0-9.-]+")) throw new IllegalArgumentException();
            port = Integer.parseInt(portInput.getText().toString());
            if (port < 1 || port > 65535) throw new IllegalArgumentException();
        } catch (Exception error) {
            status.setText("Enter an IPv4 address or hostname and a port from 1 to 65535.");
            return;
        }
        connect.setEnabled(false);
        status.setText("Resolving server...");
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    Inet4Address selected = null;
                    for (InetAddress address : InetAddress.getAllByName(host)) {
                        if (address instanceof Inet4Address) { selected = (Inet4Address)address; break; }
                    }
                    if (selected == null) throw new IllegalArgumentException("No IPv4 address");
                    byte[] value = (selected.getHostAddress() + ":" + port + "\n").getBytes("UTF-8");
                    File pending = new File(getFilesDir(), "private-server.conf.new");
                    File destination = new File(getFilesDir(), "private-server.conf");
                    FileOutputStream output = new FileOutputStream(pending);
                    try { output.write(value); output.getFD().sync(); } finally { output.close(); }
                    if (!pending.renameTo(destination)) throw new java.io.IOException("Cannot save server address");
                    if (!preferences.edit().putString("host", host).putInt("port", port).commit())
                        throw new java.io.IOException("Cannot save preferences");
                    runOnUiThread(new Runnable() {
                        @Override public void run() { launchGame(); }
                    });
                } catch (Exception error) {
                    runOnUiThread(new Runnable() {
                        @Override public void run() {
                            status.setText("Could not resolve or save this server. Check the address and try again.");
                            connect.setEnabled(true);
                        }
                    });
                }
            }
        }, "private-server-resolution").start();
    }

    private void launchGame() {
        // The launcher lives in :connection, so it can restart only this
        // package's old main process without terminating its own activity.
        ActivityManager manager = (ActivityManager)getSystemService(Context.ACTIVITY_SERVICE);
        List<ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
        if (processes != null) for (ActivityManager.RunningAppProcessInfo info : processes) {
            if (info.uid == Process.myUid() && info.pid != Process.myPid() && info.processName.equals(getPackageName()))
                Process.killProcess(info.pid);
        }
        status.setText("Starting game...");
        new Handler().postDelayed(new Runnable() {
            @Override public void run() {
                Intent intent = new Intent();
                intent.setClassName(getPackageName(), "com.supercell.clashroyale.GameApp");
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(intent);
                finish();
            }
        }, 400);
    }
}

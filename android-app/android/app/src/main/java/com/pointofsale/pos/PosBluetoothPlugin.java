package com.pointofsale.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Classic Bluetooth (SPP / RFCOMM) receipt printers: list paired devices, scan for nearby
 * devices, connect and send raw ESC/POS bytes. Most portable thermal printers use SPP.
 */
@CapacitorPlugin(
    name = "PosBluetooth",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "legacyBluetooth", strings = {
            Manifest.permission.BLUETOOTH, Manifest.permission.BLUETOOTH_ADMIN, Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class PosBluetoothPlugin extends Plugin {
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private BluetoothAdapter adapter;
    private BluetoothSocket socket;
    private OutputStream output;
    private String connectedAddress;
    private String connectedName;
    private final Map<String, JSObject> scanResults = new LinkedHashMap<>();
    private boolean scanning = false;
    private BroadcastReceiver receiver;

    @Override
    public void load() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = manager != null ? manager.getAdapter() : null;
    }

    private String permissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetooth" : "legacyBluetooth";
    }

    private boolean hasPermission() {
        return getPermissionState(permissionAlias()) == PermissionState.GRANTED;
    }

    private JSObject status() {
        JSObject r = new JSObject();
        r.put("supported", adapter != null);
        r.put("enabled", adapter != null && adapter.isEnabled());
        r.put("permission", hasPermission());
        r.put("connected", isSocketConnected());
        r.put("address", connectedAddress);
        r.put("name", connectedName);
        return r;
    }

    private boolean isSocketConnected() {
        return socket != null && socket.isConnected() && output != null;
    }

    /** Fails the call unless Bluetooth exists, is on and permitted. */
    private boolean ready(PluginCall call) {
        if (adapter == null) { call.reject("This device has no Bluetooth.", "UNSUPPORTED"); return false; }
        if (!hasPermission()) { call.reject("Bluetooth permission is needed.", "PERMISSION_DENIED"); return false; }
        if (!adapter.isEnabled()) { call.reject("Bluetooth is turned off.", "BLUETOOTH_OFF"); return false; }
        return true;
    }

    @PluginMethod
    public void getStatus(PluginCall call) { call.resolve(status()); }

    /** Asks for the Bluetooth permissions, then (if needed) asks the user to turn Bluetooth on. */
    @PluginMethod
    public void prepare(PluginCall call) {
        if (adapter == null) { call.reject("This device has no Bluetooth.", "UNSUPPORTED"); return; }
        if (!hasPermission()) { requestPermissionForAlias(permissionAlias(), call, "permissionResult"); return; }
        enableIfNeeded(call);
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        if (!hasPermission()) { call.reject("Bluetooth permission was denied. Allow \"Nearby devices\" for this app in Android settings.", "PERMISSION_DENIED"); return; }
        enableIfNeeded(call);
    }

    @SuppressLint("MissingPermission")
    private void enableIfNeeded(PluginCall call) {
        if (adapter.isEnabled()) { call.resolve(status()); return; }
        startActivityForResult(call, new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), "enableResult");
    }

    @ActivityCallback
    private void enableResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (adapter.isEnabled()) call.resolve(status());
        else call.reject("Bluetooth is turned off.", "BLUETOOTH_OFF");
    }

    @SuppressLint("MissingPermission")
    private JSObject describe(BluetoothDevice d, Integer rssi) {
        JSObject o = new JSObject();
        String name = null;
        try { name = d.getName(); } catch (SecurityException ignored) { }
        o.put("name", name != null && !name.isEmpty() ? name : d.getAddress());
        o.put("address", d.getAddress());
        boolean paired = false;
        try { paired = d.getBondState() == BluetoothDevice.BOND_BONDED; } catch (SecurityException ignored) { }
        o.put("paired", paired);
        BluetoothClass c = null;
        try { c = d.getBluetoothClass(); } catch (SecurityException ignored) { }
        boolean printer = c != null && c.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING;
        String lower = name == null ? "" : name.toLowerCase();
        if (lower.contains("print") || lower.matches(".*(pt-?2|mtp|rpp|xp-|zjiang|pos-?58|pos-?80|gp-|goojprt|mpt-|thermal|receipt).*")) printer = true;
        o.put("likelyPrinter", printer);
        if (rssi != null) o.put("rssi", rssi);
        return o;
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void getPairedDevices(PluginCall call) {
        if (!ready(call)) return;
        JSArray list = new JSArray();
        for (BluetoothDevice d : adapter.getBondedDevices()) list.put(describe(d, null));
        JSObject r = new JSObject();
        r.put("devices", list);
        call.resolve(r);
    }

    /** Starts discovery of nearby devices (about 12 seconds). Poll getScanResults for the list. */
    @SuppressLint("MissingPermission")
    @PluginMethod
    public void startScan(PluginCall call) {
        if (!ready(call)) return;
        synchronized (scanResults) { scanResults.clear(); }
        if (receiver == null) {
            receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    String action = intent.getAction();
                    if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                        BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                        short rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE);
                        if (d != null) synchronized (scanResults) { scanResults.put(d.getAddress(), describe(d, rssi == Short.MIN_VALUE ? null : (int) rssi)); }
                    } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                        scanning = false;
                    }
                }
            };
            IntentFilter filter = new IntentFilter();
            filter.addAction(BluetoothDevice.ACTION_FOUND);
            filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
            if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
            else getContext().registerReceiver(receiver, filter);
        }
        if (adapter.isDiscovering()) adapter.cancelDiscovery();
        scanning = adapter.startDiscovery();
        if (!scanning) { call.reject("Could not start scanning. Make sure Location is on (required for scanning on Android 11 and older).", "SCAN_FAILED"); return; }
        call.resolve(status());
    }

    @PluginMethod
    public void getScanResults(PluginCall call) {
        JSArray list = new JSArray();
        synchronized (scanResults) { for (JSObject o : scanResults.values()) list.put(o); }
        JSObject r = new JSObject();
        r.put("devices", list);
        r.put("scanning", scanning);
        call.resolve(r);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void stopScan(PluginCall call) {
        if (adapter != null && hasPermission() && adapter.isDiscovering()) adapter.cancelDiscovery();
        scanning = false;
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connect(final PluginCall call) {
        if (!ready(call)) return;
        final String address = call.getString("address");
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address)) { call.reject("Invalid printer address.", "INVALID"); return; }
        new Thread(() -> {
            closeSocket();
            try { adapter.cancelDiscovery(); } catch (SecurityException ignored) { }
            BluetoothDevice device = adapter.getRemoteDevice(address);
            BluetoothSocket s = null;
            IOException last = null;
            // 1) secure SPP, 2) insecure SPP, 3) channel 1 (some cheap printers only answer this)
            for (int attempt = 0; attempt < 3 && s == null; attempt++) {
                BluetoothSocket candidate = null;
                try {
                    if (attempt == 0) candidate = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    else if (attempt == 1) candidate = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                    else {
                        Method m = device.getClass().getMethod("createRfcommSocket", int.class);
                        candidate = (BluetoothSocket) m.invoke(device, 1);
                    }
                    candidate.connect();
                    s = candidate;
                } catch (Exception e) {
                    last = e instanceof IOException ? (IOException) e : new IOException(e.getMessage());
                    try { if (candidate != null) candidate.close(); } catch (IOException ignored) { }
                }
            }
            if (s == null) {
                call.reject("Could not connect to the printer. Make sure it is on, nearby and not connected to another phone." + (last != null ? " (" + last.getMessage() + ")" : ""), "CONNECT_FAILED");
                return;
            }
            try {
                socket = s;
                output = s.getOutputStream();
                connectedAddress = address;
                String name = null;
                try { name = device.getName(); } catch (SecurityException ignored) { }
                connectedName = name != null ? name : address;
                call.resolve(status());
            } catch (IOException e) {
                closeSocket();
                call.reject("Could not open the printer connection.", "CONNECT_FAILED");
            }
        }).start();
    }

    /** Sends base64-encoded bytes (ESC/POS) to the connected printer. */
    @PluginMethod
    public void write(final PluginCall call) {
        final String data = call.getString("data");
        if (data == null) { call.reject("No data.", "INVALID"); return; }
        if (!isSocketConnected()) { call.reject("The printer is not connected.", "NOT_CONNECTED"); return; }
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                for (int i = 0; i < bytes.length; i += 512) {
                    output.write(bytes, i, Math.min(512, bytes.length - i));
                    output.flush();
                    Thread.sleep(15);
                }
                call.resolve();
            } catch (Exception e) {
                closeSocket();
                call.reject("Printing failed: the printer disconnected.", "NOT_CONNECTED");
            }
        }).start();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeSocket();
        call.resolve(status());
    }

    private void closeSocket() {
        try { if (output != null) output.close(); } catch (IOException ignored) { }
        try { if (socket != null) socket.close(); } catch (IOException ignored) { }
        output = null;
        socket = null;
        connectedAddress = null;
        connectedName = null;
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            try { getContext().unregisterReceiver(receiver); } catch (Exception ignored) { }
            receiver = null;
        }
        closeSocket();
    }
}

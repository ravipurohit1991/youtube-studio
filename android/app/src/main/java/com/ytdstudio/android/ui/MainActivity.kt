package com.ytdstudio.android.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.VideoLibrary
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ytdstudio.android.engine.Engine

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handleShare(intent)
        // Progress and "download finished" notifications (Android 13+ asks once).
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent { YtdTheme { AppScreen(vm) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    private fun handleShare(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND) vm.receiveSharedText(intent.getStringExtra(Intent.EXTRA_TEXT))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppScreen(vm: MainViewModel) {
    val engine by Engine.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm.message) {
        vm.message?.let {
            snackbar.showSnackbar(it)
            vm.message = null
        }
    }
    LaunchedEffect((engine as? Engine.State.Ready)?.notice) {
        (engine as? Engine.State.Ready)?.notice?.let {
            snackbar.showSnackbar(it)
            Engine.clearNotice()
        }
    }
    Scaffold(
        topBar = {
            TopAppBar(title = {
                Column {
                    Text(
                        when (vm.tab) {
                            Tab.DOWNLOAD -> "Download"
                            Tab.STREAM -> "Stream"
                            Tab.LIBRARY -> "Library"
                            Tab.SETTINGS -> "Settings"
                        },
                    )
                    Text(
                        when (vm.tab) {
                            Tab.DOWNLOAD -> "Save a video or its audio to your phone"
                            Tab.STREAM -> "Watch without ads, without saving"
                            Tab.LIBRARY -> "Your downloads, playable offline"
                            Tab.SETTINGS -> "Quality defaults and yt-dlp"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            })
        },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar {
                listOf(
                    Triple(Tab.DOWNLOAD, "Download", Icons.Rounded.Download),
                    Triple(Tab.STREAM, "Stream", Icons.Rounded.PlayCircle),
                    Triple(Tab.LIBRARY, "Library", Icons.Rounded.VideoLibrary),
                    Triple(Tab.SETTINGS, "Settings", Icons.Rounded.Settings),
                ).forEach { (tab, label, icon) ->
                    NavigationBarItem(
                        selected = vm.tab == tab,
                        onClick = { vm.tab = tab },
                        icon = { Icon(icon, contentDescription = null) },
                        label = { Text(label) },
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            EngineBanner(engine)
            Box(Modifier.weight(1f)) {
                when (vm.tab) {
                    Tab.DOWNLOAD -> DownloadScreen(vm)
                    Tab.STREAM -> StreamScreen(vm)
                    Tab.LIBRARY -> LibraryScreen(vm)
                    Tab.SETTINGS -> SettingsScreen(vm)
                }
            }
        }
    }
}

@Composable
private fun EngineBanner(state: Engine.State) {
    val (text, busy, retry) = when (state) {
        is Engine.State.Preparing -> Triple("Preparing yt-dlp and ffmpeg (first launch takes a few seconds)...", true, false)
        is Engine.State.Updating -> Triple(state.message, true, false)
        is Engine.State.Failed -> Triple(state.message, false, true)
        is Engine.State.Ready -> return
    }
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(10.dp))
            Text(text, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            if (retry) TextButton(onClick = { Engine.retryInit() }) { Text("Retry") }
        }
    }
}

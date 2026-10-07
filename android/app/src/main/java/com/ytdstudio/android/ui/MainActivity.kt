@file:OptIn(ExperimentalLayoutApi::class)

package com.ytdstudio.android.ui

import android.Manifest
import android.app.RecoverableSecurityException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.VideoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ytdstudio.android.data.JobStatus
import com.ytdstudio.android.engine.Engine

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()
    private val ai: AiViewModel by viewModels()
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handleShare(intent)
        // Progress, "download finished" and playback notifications (Android 13+ asks once).
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent {
            val settings by vm.prefs.settings.collectAsStateWithLifecycle()
            YtdTheme(settings) { AppScreen(vm, ai) }
        }
    }

    override fun onResume() {
        super.onResume()
        // Files may have been added or removed elsewhere (Gallery, a file manager) meanwhile.
        if (vm.libraryLoaded) vm.refreshLibrary()
        vm.autoSyncIfDue()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    private fun handleShare(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND) vm.receiveSharedText(intent.getStringExtra(Intent.EXTRA_TEXT))
    }
}

@Composable
private fun AppScreen(vm: MainViewModel, ai: AiViewModel) {
    val context = LocalContext.current
    val engine by Engine.state.collectAsStateWithLifecycle()
    val jobs by vm.store.jobs.collectAsStateWithLifecycle()
    val libraryState by vm.library.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val active = jobs.count { it.status == JobStatus.QUEUED || it.status.isActive }
    val completed = jobs.count { it.status == JobStatus.COMPLETED }

    LaunchedEffect(completed) { vm.refreshLibrary() }
    LaunchedEffect(vm.message) {
        vm.message?.let {
            snackbar.showSnackbar(it)
            vm.message = null
        }
    }
    LaunchedEffect(ai.message) {
        ai.message?.let {
            snackbar.showSnackbar(it)
            ai.message = null
        }
    }
    LaunchedEffect((engine as? Engine.State.Ready)?.notice) {
        (engine as? Engine.State.Ready)?.notice?.let {
            snackbar.showSnackbar(it)
            Engine.clearNotice()
        }
    }

    BackHandler(enabled = vm.librarySelection.isNotEmpty()) { vm.clearSelection() }
    BackHandler(enabled = vm.openPlaylist != null && vm.librarySelection.isEmpty()) { vm.openPlaylist = null }
    BackHandler(enabled = vm.openPlaylist == null && vm.tab != Tab.HOME) { vm.tab = Tab.HOME }

    // Files from an earlier install belong to "another app" now, so Android asks the user before deleting.
    val deleteRequest = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { vm.refreshLibrary() }
    // Several files at once: one system confirmation, and they are forgotten only if it was accepted.
    var bulkKeys by remember { mutableStateOf(emptyList<String>()) }
    val bulkDeleteRequest = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) bulkKeys.forEach { vm.library.forget(it) }
        bulkKeys = emptyList()
        vm.refreshLibrary()
    }

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar {
                listOf(
                    Triple(Tab.HOME, "Home", Icons.Rounded.Home),
                    Triple(Tab.DISCOVER, "Discover", Icons.Rounded.AutoAwesome),
                    Triple(Tab.LIBRARY, "Library", Icons.Rounded.VideoLibrary),
                    Triple(Tab.DOWNLOADS, "Downloads", Icons.Rounded.Download),
                    Triple(Tab.SETTINGS, "Settings", Icons.Rounded.Settings),
                ).forEach { (tab, label, icon) ->
                    NavigationBarItem(
                        selected = vm.tab == tab,
                        onClick = {
                            if (tab == Tab.LIBRARY && vm.tab == Tab.LIBRARY) vm.openPlaylist = null
                            vm.clearSelection()
                            vm.tab = tab
                        },
                        icon = {
                            if (tab == Tab.DOWNLOADS && active > 0) {
                                BadgedBox(badge = { Badge { Text("$active") } }) { Icon(icon, contentDescription = null) }
                            } else {
                                Icon(icon, contentDescription = null)
                            }
                        },
                        label = { Text(label) },
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            EngineBanner(engine)
            // The banner already sits below the status bar; screens should not pad for it again.
            val belowBanner = if (engine is Engine.State.Ready) Modifier else Modifier.consumeWindowInsets(WindowInsets.statusBars)
            Box(Modifier.weight(1f).then(belowBanner)) {
                when (vm.tab) {
                    Tab.HOME -> HomeScreen(vm)
                    Tab.DISCOVER -> DiscoverScreen(vm, ai)
                    Tab.LIBRARY -> LibraryScreen(vm, ai)
                    Tab.DOWNLOADS -> DownloadsScreen(vm)
                    Tab.SETTINGS -> SettingsScreen(vm, ai)
                }
            }
        }
    }

    if (vm.sheetOpen) LinkSheet(vm)

    vm.addToPlaylist?.let { keys ->
        AddToPlaylistDialog(vm, libraryState, keys) { vm.addToPlaylist = null }
    }

    vm.pendingBulkDelete?.let { list ->
        AlertDialog(
            onDismissRequest = { vm.pendingBulkDelete = null },
            title = { Text("Delete ${list.size} file(s)?") },
            text = { Text("They are removed from your phone and from every playlist.") },
            confirmButton = {
                TextButton(onClick = {
                    vm.pendingBulkDelete = null
                    vm.clearSelection()
                    if (Build.VERSION.SDK_INT >= 30) {
                        bulkKeys = list.map { it.key }
                        val sender = MediaStore.createDeleteRequest(context.contentResolver, list.map { it.uri }).intentSender
                        bulkDeleteRequest.launch(IntentSenderRequest.Builder(sender).build())
                    } else {
                        var failed = 0
                        list.forEach { item ->
                            try {
                                context.contentResolver.delete(item.uri, null, null)
                                vm.forgetDeleted(item)
                            } catch (e: SecurityException) {
                                failed++
                            }
                        }
                        if (failed > 0) vm.message = "Android did not allow deleting $failed file(s)."
                        vm.refreshLibrary()
                    }
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { vm.pendingBulkDelete = null }) { Text("Cancel") } },
        )
    }

    vm.pendingDelete?.let { item ->
        AlertDialog(
            onDismissRequest = { vm.pendingDelete = null },
            title = { Text("Delete this file?") },
            text = { Text(item.name + "\n\nIt is removed from your phone and from every playlist.") },
            confirmButton = {
                TextButton(onClick = {
                    vm.pendingDelete = null
                    try {
                        context.contentResolver.delete(item.uri, null, null)
                        vm.forgetDeleted(item)
                    } catch (e: SecurityException) {
                        val sender = when {
                            Build.VERSION.SDK_INT >= 30 -> MediaStore.createDeleteRequest(context.contentResolver, listOf(item.uri)).intentSender
                            e is RecoverableSecurityException -> e.userAction.actionIntent.intentSender
                            else -> null
                        }
                        if (sender != null) {
                            vm.library.forget(item.key)
                            deleteRequest.launch(IntentSenderRequest.Builder(sender).build())
                        } else {
                            vm.message = "Android did not allow deleting that file."
                        }
                    }
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { vm.pendingDelete = null }) { Text("Cancel") } },
        )
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
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(10.dp))
            Text(text, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSecondaryContainer)
            if (retry) TextButton(onClick = { Engine.retryInit() }) { Text("Retry") }
        }
    }
}

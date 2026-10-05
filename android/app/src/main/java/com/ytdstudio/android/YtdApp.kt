package com.ytdstudio.android

import android.app.Application
import com.ytdstudio.android.ai.Ai
import com.ytdstudio.android.data.JobStore
import com.ytdstudio.android.data.LibraryStore
import com.ytdstudio.android.data.Prefs
import com.ytdstudio.android.engine.Engine
import com.ytdstudio.android.service.Notifications

class YtdApp : Application() {
    lateinit var prefs: Prefs
        private set
    lateinit var jobs: JobStore
        private set
    lateinit var library: LibraryStore
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = Prefs(this)
        jobs = JobStore(this)
        library = LibraryStore(this)
        Ai.init(this, prefs, library)
        Notifications.createChannels(this)
        // Unpacks python/ffmpeg on first run and keeps yt-dlp current, in the background.
        Engine.start(this, prefs)
    }

    companion object {
        lateinit var instance: YtdApp
            private set
    }
}

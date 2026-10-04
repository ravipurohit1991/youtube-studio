package com.ytdstudio.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Same palette as the desktop app (styles.css).
val Accent = Color(0xFFE5324B)
val Ok = Color(0xFF3DBE7A)
val Warn = Color(0xFFE8A33D)

private val Dark = darkColorScheme(
    primary = Accent,
    onPrimary = Color.White,
    secondary = Color(0xFF7B2DFF),
    background = Color(0xFF0D1017),
    surface = Color(0xFF141A24),
    surfaceVariant = Color(0xFF182030),
    surfaceContainer = Color(0xFF141A24),
    surfaceContainerHigh = Color(0xFF1B2331),
    onBackground = Color(0xFFE6EAF0),
    onSurface = Color(0xFFE6EAF0),
    onSurfaceVariant = Color(0xFF98A4B6),
    error = Color(0xFFFF6161),
)

private val Light = lightColorScheme(
    primary = Accent,
    onPrimary = Color.White,
    secondary = Color(0xFF7B2DFF),
    background = Color(0xFFF4F6FA),
    surface = Color.White,
    surfaceVariant = Color(0xFFEEF1F7),
    onSurfaceVariant = Color(0xFF5A6478),
)

@Composable
fun YtdTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}

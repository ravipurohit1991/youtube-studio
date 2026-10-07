package com.ytdstudio.android.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ytdstudio.android.data.Settings
import com.ytdstudio.android.data.ThemeMode

// Brand colors, shared with the desktop app (styles.css).
val Accent = Color(0xFFE5324B)
val AccentBright = Color(0xFFFF5470)
val Violet = Color(0xFF7B5CFF)
val Ok = Color(0xFF34C17E)
val Warn = Color(0xFFE8A33D)

private val Dark = darkColorScheme(
    primary = AccentBright,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF5A1424),
    onPrimaryContainer = Color(0xFFFFD9DF),
    secondary = Color(0xFF9C8BFF),
    onSecondary = Color(0xFF1B1446),
    secondaryContainer = Color(0xFF2E2860),
    onSecondaryContainer = Color(0xFFE4DFFF),
    tertiary = Color(0xFF4FD8A8),
    background = Color(0xFF0A0D13),
    onBackground = Color(0xFFE7EBF2),
    surface = Color(0xFF0A0D13),
    onSurface = Color(0xFFE7EBF2),
    surfaceVariant = Color(0xFF1B2130),
    onSurfaceVariant = Color(0xFF9BA6B9),
    surfaceContainerLowest = Color(0xFF06080C),
    surfaceContainerLow = Color(0xFF10141C),
    surfaceContainer = Color(0xFF141924),
    surfaceContainerHigh = Color(0xFF1A202C),
    surfaceContainerHighest = Color(0xFF212836),
    outline = Color(0xFF3A4457),
    outlineVariant = Color(0xFF252C3A),
    error = Color(0xFFFF6B6B),
)

private val Light = lightColorScheme(
    primary = Accent,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFDADF),
    onPrimaryContainer = Color(0xFF40000F),
    secondary = Color(0xFF5B48E0),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE5E0FF),
    onSecondaryContainer = Color(0xFF180A62),
    tertiary = Color(0xFF00875A),
    background = Color(0xFFF6F7FB),
    onBackground = Color(0xFF141824),
    surface = Color(0xFFF6F7FB),
    onSurface = Color(0xFF141824),
    surfaceVariant = Color(0xFFE9ECF4),
    onSurfaceVariant = Color(0xFF586277),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFF0F2F8),
    surfaceContainerHigh = Color(0xFFEAEDF5),
    surfaceContainerHighest = Color(0xFFE3E7F0),
    outline = Color(0xFFB9C1D1),
    outlineVariant = Color(0xFFDCE1EB),
)

private val base = Typography()
private val AppTypography = base.copy(
    displaySmall = base.displaySmall.copy(fontWeight = FontWeight.Bold),
    headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.Bold),
    headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.Bold),
    titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold),
    titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
    titleSmall = base.titleSmall.copy(fontWeight = FontWeight.SemiBold),
    labelLarge = base.labelLarge.copy(fontWeight = FontWeight.SemiBold),
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(22.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/** An accent preset: the strong color, a brighter one for dark mode, and a partner for gradients. */
data class AccentSpec(val label: String, val base: Color, val bright: Color, val partner: Color)

val ACCENTS: Map<String, AccentSpec> = linkedMapOf(
    "crimson" to AccentSpec("Crimson", Accent, AccentBright, Violet),
    "violet" to AccentSpec("Violet", Color(0xFF6D4AFF), Color(0xFF9B82FF), Color(0xFF22B8F0)),
    "ocean" to AccentSpec("Ocean", Color(0xFF1D7FE0), Color(0xFF4AA8FF), Color(0xFF13C2B4)),
    "emerald" to AccentSpec("Emerald", Color(0xFF0E9F6E), Color(0xFF34D399), Color(0xFF1D8CF8)),
    "amber" to AccentSpec("Amber", Color(0xFFD97706), Color(0xFFFBBF24), Color(0xFFEF4444)),
    "rose" to AccentSpec("Rose", Color(0xFFDB2777), Color(0xFFF472B6), Color(0xFF8B5CF6)),
)

private fun withAccent(scheme: androidx.compose.material3.ColorScheme, accent: AccentSpec, dark: Boolean) = if (dark) {
    scheme.copy(
        primary = accent.bright,
        onPrimary = if (accent.label == "Amber") Color(0xFF1A1204) else Color.White,
        primaryContainer = lerp(Color(0xFF0A0D13), accent.base, 0.38f),
        onPrimaryContainer = lerp(Color.White, accent.bright, 0.2f),
        secondary = lerp(accent.partner, Color.White, 0.25f),
        secondaryContainer = lerp(Color(0xFF0A0D13), accent.partner, 0.32f),
        onSecondaryContainer = lerp(Color.White, accent.partner, 0.15f),
    )
} else {
    scheme.copy(
        primary = accent.base,
        onPrimary = Color.White,
        primaryContainer = lerp(Color.White, accent.base, 0.16f),
        onPrimaryContainer = lerp(Color.Black, accent.base, 0.55f),
        secondary = accent.partner,
        secondaryContainer = lerp(Color.White, accent.partner, 0.16f),
        onSecondaryContainer = lerp(Color.Black, accent.partner, 0.6f),
    )
}

@Composable
fun YtdTheme(settings: Settings, content: @Composable () -> Unit) {
    val dark = when (settings.themeMode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    val context = LocalContext.current
    val scheme = when {
        settings.dynamicColor && Build.VERSION.SDK_INT >= 31 -> if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> withAccent(Dark, ACCENTS[settings.accent] ?: ACCENTS.getValue("crimson"), true)
        else -> withAccent(Light, ACCENTS[settings.accent] ?: ACCENTS.getValue("crimson"), false)
    }
    MaterialTheme(colorScheme = scheme, typography = AppTypography, shapes = AppShapes, content = content)
}

param([Parameter(Mandatory=$true)][ValidateSet('before','after')][string]$Variant,
      [Parameter(Mandatory=$true)][string]$Out)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Out | Out-Null

function New-Canvas([int]$w, [int]$h, [System.Drawing.Color]$fill) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  if ($fill -ne [System.Drawing.Color]::Transparent) { $g.Clear($fill) }
  return @{ bmp = $bmp; g = $g }
}

function Save-Img($c, [string]$path, $format) {
  $c.g.Dispose(); $c.bmp.Save($path, $format); $c.bmp.Dispose()
}

$after = $Variant -eq 'after'
$png  = [System.Drawing.Imaging.ImageFormat]::Png
$jpeg = [System.Drawing.Imaging.ImageFormat]::Jpeg
$gif  = [System.Drawing.Imaging.ImageFormat]::Gif
$bmpF = [System.Drawing.Imaging.ImageFormat]::Bmp

# 1. Same dimensions, one colour changes. The clean case for onion-skin,
#    difference blend and a swipe: everything lines up, one thing moved.
$c = New-Canvas 160 160 ([System.Drawing.Color]::White)
$brush = New-Object System.Drawing.SolidBrush ($(if ($after) { [System.Drawing.Color]::FromArgb(31,136,61) } else { [System.Drawing.Color]::FromArgb(9,105,218) }))
$c.g.FillEllipse($brush, 20, 20, 120, 120)
Save-Img $c (Join-Path $Out 'logo.png') $png

# 2. Lossy format, and the change is a moved element rather than a recolour.
$c = New-Canvas 240 160 ([System.Drawing.Color]::White)
for ($x = 0; $x -lt 240; $x++) {
  $p = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, [int](40 + $x / 2), 90, [int](200 - $x / 2)))
  $c.g.DrawLine($p, $x, 0, $x, 160); $p.Dispose()
}
$bar = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 220, 40, 40))
$c.g.FillRectangle($bar, $(if ($after) { 150 } else { 20 }), 30, 60, 100)
Save-Img $c (Join-Path $Out 'photo.jpg') $jpeg

# 3. The dimensions themselves change. Every overlay mode has to decide what
#    to do when the two sides are not the same shape.
$w = $(if ($after) { 320 } else { 200 }); $h = $(if ($after) { 180 } else { 120 })
$c = New-Canvas $w $h ([System.Drawing.Color]::FromArgb(255, 250, 200, 90))
$c.g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60,60,70))), 10, 10, $w - 20, 24)
$c.g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60,60,70))), 10, 50, [int](($w - 20) * 0.6), 16)
Save-Img $c (Join-Path $Out 'resized.png') $png

# 4. An alpha channel, so an onion-skin has to composite against something
#    rather than assume an opaque backdrop.
$c = New-Canvas 120 120 ([System.Drawing.Color]::Transparent)
$sq = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(140, 200, 40, 160))
$c.g.FillRectangle($sq, $(if ($after) { 40 } else { 15 }), $(if ($after) { 40 } else { 15 }), 60, 60)
Save-Img $c (Join-Path $Out 'transparent.png') $png

# 5. Indexed colour, and a format a naive <img> swap handles but a canvas
#    read-back may not.
$c = New-Canvas 100 100 ([System.Drawing.Color]::FromArgb(0, 128, 128))
$c.g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Yellow)), $(if ($after) { 55 } else { 10 }), 25, 35, 50)
Save-Img $c (Join-Path $Out 'animation.gif') $gif

# 6. Small, uncompressed, and every pixel differs between the two sides.
$c = New-Canvas 32 32 ([System.Drawing.Color]::White)
for ($y = 0; $y -lt 32; $y += 8) { for ($x = 0; $x -lt 32; $x += 8) {
  $dark = ((($x / 8) + ($y / 8)) % 2) -eq $(if ($after) { 1 } else { 0 })
  if ($dark) { $c.g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Black)), $x, $y, 8, 8) }
} }
Save-Img $c (Join-Path $Out 'icon.bmp') $bmpF

# 7. Far larger than the column is wide. Whatever the renderer does about
#    scale, it has to do it without locking the page up.
$c = New-Canvas 1600 1200 ([System.Drawing.Color]::FromArgb(245, 246, 250))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(210, 214, 222)), 2
for ($x = 0; $x -lt 1600; $x += 40) { $c.g.DrawLine($pen, $x, 0, $x, 1200) }
for ($y = 0; $y -lt 1200; $y += 40) { $c.g.DrawLine($pen, 0, $y, 1600, $y) }
$c.g.FillEllipse((New-Object System.Drawing.SolidBrush ($(if ($after) { [System.Drawing.Color]::FromArgb(207,34,46) } else { [System.Drawing.Color]::FromArgb(130,80,223) }))),
                 $(if ($after) { 900 } else { 200 }), 300, 500, 500)
Save-Img $c (Join-Path $Out 'huge.png') $png

if ($after) {
  # Added on this side only: there is no "before" to compare against.
  $c = New-Canvas 80 80 ([System.Drawing.Color]::White)
  $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(31,136,61))
  $c.g.FillRectangle($b, 34, 12, 12, 56); $c.g.FillRectangle($b, 12, 34, 56, 12)
  Save-Img $c (Join-Path $Out 'added.png') $png
} else {
  # Deleted on the other side: there is no "after".
  $c = New-Canvas 80 80 ([System.Drawing.Color]::White)
  $p = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(207,34,46)), 10
  $c.g.DrawLine($p, 14, 14, 66, 66); $c.g.DrawLine($p, 66, 14, 14, 66)
  Save-Img $c (Join-Path $Out 'removed.png') $png
}
"wrote $Variant"

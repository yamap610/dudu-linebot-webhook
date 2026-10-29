param(
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\assets\rich-menu-main.jpg')
)

Add-Type -AssemblyName System.Drawing

$width = 2500
$height = 1686
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#FCFAF7'))

function New-RoundedPath([System.Drawing.RectangleF]$rect, [float]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $arc = New-Object System.Drawing.RectangleF($rect.X, $rect.Y, $diameter, $diameter)
  $path.AddArc($arc, 180, 90)
  $arc.X = $rect.Right - $diameter
  $path.AddArc($arc, 270, 90)
  $arc.Y = $rect.Bottom - $diameter
  $path.AddArc($arc, 0, 90)
  $arc.X = $rect.X
  $path.AddArc($arc, 90, 90)
  $path.CloseFigure()
  return $path
}

$cards = @(
  @{ X = 50;   Y = 55;  Color = '#FDECE8'; Border = '#F2C7BE'; Icon = '💳'; Label = '待繳費' },
  @{ X = 860;  Y = 55;  Color = '#FFF2E1'; Border = '#F2D2A2'; Icon = '⏳'; Label = '效期提醒' },
  @{ X = 1670; Y = 55;  Color = '#EEF3E8'; Border = '#CAD8BC'; Icon = '📅'; Label = '行程查詢' },
  @{ X = 50;   Y = 871; Color = '#F2EAF7'; Border = '#D7C6E3'; Icon = '✅'; Label = '待辦事項' },
  @{ X = 860;  Y = 871; Color = '#EAF3FA'; Border = '#C4D8E7'; Icon = '🛒'; Label = '待買清單' },
  @{ X = 1670; Y = 871; Color = '#FFF0E5'; Border = '#EECDB5'; Icon = '🧰'; Label = '更多' }
)

$cardWidth = 780
$cardHeight = 760
$iconFont = New-Object System.Drawing.Font('Segoe UI Emoji', 172, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$labelFont = New-Object System.Drawing.Font('Microsoft JhengHei', 78, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#3D3028'))
$center = New-Object System.Drawing.StringFormat
$center.Alignment = [System.Drawing.StringAlignment]::Center
$center.LineAlignment = [System.Drawing.StringAlignment]::Center

foreach ($card in $cards) {
  $rect = New-Object System.Drawing.RectangleF([float]$card.X, [float]$card.Y, [float]$cardWidth, [float]$cardHeight)
  $path = New-RoundedPath $rect 56
  $fill = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($card.Color))
  $border = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($card.Border), 4)
  $graphics.FillPath($fill, $path)
  $graphics.DrawPath($border, $path)

  $iconRect = New-Object System.Drawing.RectangleF([float]$card.X, [float]($card.Y + 95), [float]$cardWidth, 330)
  $labelRect = New-Object System.Drawing.RectangleF([float]$card.X, [float]($card.Y + 485), [float]$cardWidth, 150)
  $graphics.DrawString($card.Icon, $iconFont, $labelBrush, $iconRect, $center)
  $graphics.DrawString($card.Label, $labelFont, $labelBrush, $labelRect, $center)

  $fill.Dispose()
  $border.Dispose()
  $path.Dispose()
}

$encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$qualityEncoder = [System.Drawing.Imaging.Encoder]::Quality
$parameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
$parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($qualityEncoder, [long]90)
$target = [System.IO.Path]::GetFullPath($OutputPath)
$bitmap.Save($target, $encoder, $parameters)

$parameters.Dispose()
$center.Dispose()
$labelBrush.Dispose()
$labelFont.Dispose()
$iconFont.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Rich Menu image generated: $target"

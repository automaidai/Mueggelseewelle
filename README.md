# Müggelseewelle – stündlicher Player-Test

GitHub Actions öffnet jede Stunde ungefähr zur Minute 17 sieben Radioseiten in getrennten Browser-Kontexten, betätigt Play (bzw. erkennt den Autostart) und prüft über mehrere Messungen, ob die Abspielzeit des Senderplayers steigt. Keine Audioaufnahme, keine Screenshots, keine Benachrichtigungen per E-Mail.

Die sieben Ziele sind in `monitor.cjs` hinterlegt. Werbung und andere Medien auf der Seite zählen nicht als bestätigter Senderstart. Ein externer Schutz kann einzelne Portale blockieren. Der Test verwendet keine Umgehung von Sicherheitsprüfungen.

Ergebnisse werden in einem Bericht an Make geschickt. Die Empfangsadresse bleibt im Actions-Secret `MAKE_WEBHOOK_URL`. Die einzelnen Ergebnisse werden nicht in öffentlichen Workflow-Logs ausgegeben oder als Artefakte hochgeladen.

## In Make lesen

Szenario: „Technik-Test | 7 Radio-Player | stündliche Ergebnisse“. Unter History den Lauf und das Webhook-Modul öffnen. `results` enthält je Plattform den Status, eine Erklärung, HTTP-Status und Laufzeit. `summary` zählt die Ergebnisse.

- `GESTARTET`: Senderplayer läuft; Abspielzeit steigt in mehreren Messungen.
- `FEHLER`: HTTP-/Medienfehler oder Senderplayer startet nach Betätigung von Play nicht innerhalb von 20 Sekunden.
- `BLOCKIERT`: Zugriffsschutz verhindert die Prüfung. Das ist keine bestätigte Senderstörung.
- `UNGEPRUEFT`: Layout, Ladeproblem oder nicht eindeutig zuordenbare Wiedergabe. Manuelle Prüfung erforderlich.

Es wird nur der kurze Wiedergabestart geprüft; hörbarer Ton und unterbrechungsfreie Wiedergabe über längere Zeit werden nicht bestätigt. Ein geänderter Stream oder ein neues Playerlayout kann eine Anpassung erfordern.

## Betrieb

Öffentliches Repository mit einem kostenlosen Standard-Linux-Runner. Make verbraucht etwa einen Webhook-Empfang pro Stunde (672–744 pro Monat, zusätzliche Probeläufe und sonstige Szenarien kommen hinzu). Die Aufbewahrung der Ergebnisse richtet sich nach dem Make-Tarif.

GitHub-Zeitpläne können verzögert werden oder bei Last ausfallen. Nach 60 Tagen ohne Repository-Aktivität deaktiviert GitHub öffentliche Zeitpläne; dann im Actions-Bereich wieder aktivieren. Manuelle Testläufe sind über „Run workflow“ möglich.

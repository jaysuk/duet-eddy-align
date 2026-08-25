<template>
  <v-container fluid class="pa-2 align-start">
    <v-card class="ea-page-card" width="100%">
      <v-card-title class="text-subtitle-1 d-flex align-center">
        <v-icon class="mr-2">mdi-magnet</v-icon>
        {{ $t("plugins.duetEddyAlign.title") }}
        <v-spacer />
        <v-btn
          variant="text"
          size="small"
          prepend-icon="mdi-github"
          href="https://github.com/jaysuk/duet-eddy-align"
          target="_blank"
          rel="noopener"
        >
          {{ $t("plugins.duetEddyAlign.status.repoLink") }}
        </v-btn>
      </v-card-title>
      <v-divider />
      <EddyAlignWidget />
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import EddyAlignWidget from "./widgets/EddyAlignWidget.vue";
</script>

<style scoped>
.ea-page-card { display: flex; flex-direction: column; }
</style>
